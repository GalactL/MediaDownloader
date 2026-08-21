#include "Core.h"
#include "ChildProcess.h"

#include <windows.h>
#include <shlobj.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <mutex>
#include <optional>
#include <regex>
#include <sstream>
#include <string>

using namespace media_downloader;

namespace
{
    std::atomic_bool g_cancelRequested{};
    std::mutex g_outputMutex;

    BOOL WINAPI ConsoleHandler(DWORD event)
    {
        if (event == CTRL_C_EVENT || event == CTRL_BREAK_EVENT || event == CTRL_CLOSE_EVENT)
        {
            g_cancelRequested = true;
            return TRUE;
        }
        return FALSE;
    }

    void Emit(std::string const& json)
    {
        std::scoped_lock lock(g_outputMutex);
        std::cout << json << '\n' << std::flush;
    }

    void EmitLog(std::string const& level, std::string const& message)
    {
        Emit("{\"type\":\"log\",\"level\":\"" + JsonEscape(level) + "\",\"message\":\"" + JsonEscape(message) + "\"}");
    }

    void EmitError(std::string const& code, std::string const& message)
    {
        Emit("{\"type\":\"error\",\"code\":\"" + JsonEscape(code) + "\",\"message\":\"" + JsonEscape(message) + "\"}");
    }

    void EmitProgress(std::string const& stage, double percent, int pass = 0)
    {
        std::ostringstream json;
        json << "{\"type\":\"progress\",\"stage\":\"" << stage << "\",\"percent\":"
             << std::fixed << std::setprecision(1) << std::clamp(percent, 0.0, 100.0);
        if (pass > 0) json << ",\"pass\":" << pass;
        json << '}';
        Emit(json.str());
    }

    std::filesystem::path ExecutableDirectory()
    {
        std::wstring buffer(32768, L'\0');
        auto length = GetModuleFileNameW(nullptr, buffer.data(), static_cast<DWORD>(buffer.size()));
        buffer.resize(length);
        return std::filesystem::path(buffer).parent_path();
    }

    std::optional<std::filesystem::path> FromEnvironment(wchar_t const* name)
    {
        auto required = GetEnvironmentVariableW(name, nullptr, 0);
        if (required == 0) return std::nullopt;
        std::wstring value(required, L'\0');
        GetEnvironmentVariableW(name, value.data(), required);
        if (!value.empty() && value.back() == L'\0') value.pop_back();
        if (!value.empty() && std::filesystem::is_regular_file(value)) return std::filesystem::path(value);
        return std::nullopt;
    }

    std::optional<std::filesystem::path> FindOnPath(std::wstring const& filename)
    {
        std::wstring buffer(32768, L'\0');
        auto length = SearchPathW(nullptr, filename.c_str(), nullptr, static_cast<DWORD>(buffer.size()), buffer.data(), nullptr);
        if (length == 0 || length >= buffer.size()) return std::nullopt;
        buffer.resize(length);
        return std::filesystem::path(buffer);
    }

    std::optional<std::filesystem::path> FindTool(
        std::optional<std::filesystem::path> const& explicitPath,
        wchar_t const* environmentName,
        wchar_t const* filename)
    {
        if (explicitPath && std::filesystem::is_regular_file(*explicitPath)) return std::filesystem::absolute(*explicitPath);
        if (auto environment = FromEnvironment(environmentName)) return environment;

        std::filesystem::path candidates[]{
            ExecutableDirectory() / L"tools" / L"bin" / filename,
            ExecutableDirectory() / filename,
            std::filesystem::current_path() / L"tools" / L"bin" / filename
        };
        for (auto const& candidate : candidates)
            if (std::filesystem::is_regular_file(candidate)) return std::filesystem::absolute(candidate);
        return FindOnPath(filename);
    }

    std::filesystem::path VideosDirectory()
    {
        PWSTR raw{};
        if (FAILED(SHGetKnownFolderPath(FOLDERID_Videos, KF_FLAG_CREATE, nullptr, &raw)))
            throw std::runtime_error("Le dossier Windows Vidéos est indisponible");
        std::filesystem::path result(raw);
        CoTaskMemFree(raw);
        return result;
    }

    std::filesystem::path UniqueDestination(std::filesystem::path desired, bool overwrite)
    {
        if (overwrite || !std::filesystem::exists(desired)) return desired;
        auto directory = desired.parent_path();
        auto stem = desired.stem().wstring();
        auto extension = desired.extension().wstring();
        for (unsigned index = 2; index < 10000; ++index)
        {
            auto candidate = directory / (stem + L" (" + std::to_wstring(index) + L")" + extension);
            if (!std::filesystem::exists(candidate)) return candidate;
        }
        throw std::runtime_error("Impossible de générer un nom de fichier unique");
    }

    std::string Trim(std::string value)
    {
        auto first = value.find_first_not_of(" \t\r\n");
        if (first == std::string::npos) return {};
        auto last = value.find_last_not_of(" \t\r\n");
        return value.substr(first, last - first + 1);
    }

    std::optional<double> ParseDownloadPercent(std::string const& line)
    {
        static std::regex const pattern(R"(\[download\]\s+([0-9]+(?:\.[0-9]+)?)%)");
        std::smatch match;
        if (!std::regex_search(line, match, pattern)) return std::nullopt;
        try { return std::stod(match[1].str()); }
        catch (...) { return std::nullopt; }
    }

    std::optional<std::filesystem::path> FindDownloadedFile(std::filesystem::path const& directory)
    {
        std::error_code error;
        std::optional<std::filesystem::path> result;
        std::filesystem::file_time_type newest{};
        for (auto const& item : std::filesystem::directory_iterator(directory, error))
        {
            if (error || !item.is_regular_file(error)) continue;
            auto extension = item.path().extension().wstring();
            std::transform(extension.begin(), extension.end(), extension.begin(), ::towlower);
            if (extension == L".part" || extension == L".ytdl" || extension == L".log") continue;
            auto timestamp = item.last_write_time(error);
            if (!result || timestamp > newest) { result = item.path(); newest = timestamp; }
        }
        return result;
    }

    void AppendAuthenticationArguments(std::vector<std::wstring>& arguments, Options const& options)
    {
        if (!options.cookiesFromBrowser) return;
        auto browser = *options.cookiesFromBrowser;
        if (browser == L"auto")
        {
            if (!IsYouTubeUrl(options.url)) return;
            browser = L"firefox";
        }
        arguments.insert(arguments.end(), { L"--cookies-from-browser", browser });
    }

    std::optional<std::filesystem::path> AppendJavaScriptRuntimeArguments(std::vector<std::wstring>& arguments)
    {
        auto deno = FindTool(std::nullopt, L"MEDIADOWNLOADER_DENO", L"deno.exe");
        if (deno)
        {
            arguments.insert(arguments.end(), { L"--js-runtimes", L"deno:" + deno->wstring() });
            return deno;
        }
        auto node = FindTool(std::nullopt, L"MEDIADOWNLOADER_NODE", L"node.exe");
        if (node)
        {
            arguments.insert(arguments.end(), { L"--js-runtimes", L"node:" + node->wstring() });
            return node;
        }
        return std::nullopt;
    }

    void MoveCompletedFile(std::filesystem::path const& source, std::filesystem::path const& destination, bool overwrite)
    {
        std::error_code error;
        if (overwrite && std::filesystem::exists(destination)) std::filesystem::remove(destination, error);
        error.clear();
        std::filesystem::rename(source, destination, error);
        if (error) throw std::runtime_error("Impossible de déplacer le fichier final vers le dossier Vidéos");
    }

    struct TemporaryDirectory
    {
        std::filesystem::path path;
        ~TemporaryDirectory()
        {
            if (!path.empty())
            {
                std::error_code error;
                std::filesystem::remove_all(path, error);
            }
        }
    };

    TemporaryDirectory CreateTemporaryDirectory(std::filesystem::path const& output)
    {
        auto ticks = std::chrono::steady_clock::now().time_since_epoch().count();
        auto path = output / (L".mediadownloader-" + std::to_wstring(GetCurrentProcessId()) + L"-" + std::to_wstring(ticks));
        std::filesystem::create_directories(path);
        return { path };
    }

    double ProbeDuration(std::filesystem::path const& ffprobe, std::filesystem::path const& source)
    {
        auto result = RunProcess(ffprobe,
            { L"-v", L"error", L"-show_entries", L"format=duration", L"-of", L"default=noprint_wrappers=1:nokey=1", source.wstring() },
            source.parent_path(), {}, g_cancelRequested);
        if (result.cancelled) throw std::runtime_error("Traitement annulé");
        if (result.exitCode != 0) throw std::runtime_error("ffprobe n'a pas pu déterminer la durée de la vidéo");
        try
        {
            double duration = std::stod(Trim(result.output));
            if (!std::isfinite(duration) || duration <= 0.0) throw std::runtime_error("durée invalide");
            return duration;
        }
        catch (...) { throw std::runtime_error("La durée retournée par ffprobe est invalide"); }
    }

    void EncodeToSize(
        std::filesystem::path const& ffmpeg,
        std::filesystem::path const& source,
        std::filesystem::path const& destination,
        double duration,
        EncodePlan const& plan,
        std::wstring const& quality)
    {
        auto passLog = source.parent_path() / L"ffmpeg-pass";
        auto videoRate = std::to_wstring(plan.videoKbps) + L"k";
        auto audioRate = std::to_wstring(plan.audioKbps) + L"k";

        for (int pass = 1; pass <= 2; ++pass)
        {
            std::vector<std::wstring> arguments{
                L"-y", L"-i", source.wstring(), L"-map", L"0:v:0", L"-c:v", L"libx264",
                L"-preset", L"medium", L"-b:v", videoRate, L"-pass", std::to_wstring(pass),
                L"-passlogfile", passLog.wstring(), L"-progress", L"pipe:1", L"-nostats"
            };
            if (quality != L"best")
            {
                arguments.insert(arguments.begin() + 5, { L"-vf", L"scale=-2:min(ih\\," + quality + L")" });
            }
            if (pass == 1)
            {
                arguments.insert(arguments.end(), { L"-an", L"-f", L"null", L"NUL" });
            }
            else
            {
                arguments.insert(arguments.end(), {
                    L"-map", L"0:a:0?", L"-c:a", L"aac", L"-b:a", audioRate,
                    L"-movflags", L"+faststart", destination.wstring()
                });
            }

            auto result = RunProcess(ffmpeg, arguments, source.parent_path(), [duration, pass](std::string const& line)
            {
                if (!line.starts_with("out_time_us=")) return;
                try
                {
                    auto microseconds = std::stod(line.substr(12));
                    auto passPercent = microseconds / (duration * 1'000'000.0) * 100.0;
                    auto overall = (pass - 1) * 50.0 + std::clamp(passPercent, 0.0, 100.0) * 0.5;
                    EmitProgress("encode", overall, pass);
                }
                catch (...) {}
            }, g_cancelRequested);
            if (result.cancelled) throw std::runtime_error("Traitement annulé");
            if (result.exitCode != 0) throw std::runtime_error("FFmpeg a échoué pendant l'encodage passe " + std::to_string(pass));
        }
    }

    int RunDoctor(Options const& options)
    {
        auto ytDlp = FindTool(options.ytDlp, L"MEDIADOWNLOADER_YTDLP", L"yt-dlp.exe");
        auto ffmpeg = FindTool(options.ffmpeg, L"MEDIADOWNLOADER_FFMPEG", L"ffmpeg.exe");
        auto ffprobe = FindTool(options.ffprobe, L"MEDIADOWNLOADER_FFPROBE", L"ffprobe.exe");
        std::vector<std::wstring> runtimeArguments;
        auto jsRuntime = AppendJavaScriptRuntimeArguments(runtimeArguments);
        auto toolJson = [](char const* name, auto const& path)
        {
            return std::string("\"") + name + "\":{\"found\":" + (path ? "true" : "false") +
                (path ? ",\"path\":\"" + JsonEscape(WideToUtf8(path->wstring())) + "\"}" : "}");
        };
        Emit("{\"type\":\"doctor\",\"tools\":{" + toolJson("yt-dlp", ytDlp) + ',' +
            toolJson("ffmpeg", ffmpeg) + ',' + toolJson("ffprobe", ffprobe) + ',' + toolJson("javascript-runtime", jsRuntime) + "}}");
        return ytDlp && ffmpeg && ffprobe && jsRuntime ? 0 : 3;
    }

    int RunProbe(Options const& options)
    {
        auto ytDlp = FindTool(options.ytDlp, L"MEDIADOWNLOADER_YTDLP", L"yt-dlp.exe");
        if (!ytDlp) { EmitError("tool_missing", "yt-dlp.exe est introuvable"); return 3; }
        std::vector<std::wstring> arguments{ L"--dump-single-json", L"--no-playlist", L"--no-warnings", L"--quiet" };
        AppendJavaScriptRuntimeArguments(arguments);
        AppendAuthenticationArguments(arguments, options);
        arguments.push_back(options.url);
        auto result = RunProcess(*ytDlp, arguments,
            std::filesystem::current_path(), {}, g_cancelRequested);
        if (result.cancelled) { EmitError("cancelled", "Inspection annulée"); return 4; }
        auto payload = Trim(result.output);
        if (result.exitCode != 0 || payload.empty() || payload.front() != '{')
        {
            EmitError("probe_failed", payload.empty() ? "yt-dlp n'a retourné aucune information" : payload);
            return 4;
        }
        Emit("{\"type\":\"probe\",\"data\":" + payload + "}");
        return 0;
    }

    int RunDownload(Options const& options)
    {
        auto ytDlp = FindTool(options.ytDlp, L"MEDIADOWNLOADER_YTDLP", L"yt-dlp.exe");
        if (!ytDlp) { EmitError("tool_missing", "yt-dlp.exe est introuvable"); return 3; }

        auto ffmpeg = FindTool(options.ffmpeg, L"MEDIADOWNLOADER_FFMPEG", L"ffmpeg.exe");
        auto ffprobe = FindTool(options.ffprobe, L"MEDIADOWNLOADER_FFPROBE", L"ffprobe.exe");
        if (!ffmpeg)
        {
            EmitError("tool_missing", "ffmpeg.exe est requis pour assembler les flux vidéo et audio");
            return 3;
        }
        if (options.maxSizeMb && (!ffmpeg || !ffprobe))
        {
            EmitError("tool_missing", "ffmpeg.exe et ffprobe.exe sont requis pour limiter la taille");
            return 3;
        }

        auto output = options.outputDirectory.empty() ? VideosDirectory() : std::filesystem::absolute(options.outputDirectory);
        std::filesystem::create_directories(output);
        auto temporary = CreateTemporaryDirectory(output);
        Emit("{\"type\":\"started\",\"outputDirectory\":\"" + JsonEscape(WideToUtf8(output.wstring())) + "\"}");

        std::filesystem::path reportedPath;
        std::vector<std::wstring> arguments{
            L"--newline", L"--no-color", L"--no-playlist", L"--windows-filenames", L"--no-overwrites",
            L"--format", BuildFormatSelector(options.quality),
            L"--ffmpeg-location", ffmpeg->parent_path().wstring(),
            L"--merge-output-format", options.format,
            L"--output", (temporary.path / L"%(title).180B [%(id)s].%(ext)s").wstring(),
            L"--print", L"after_move:__MD_FILE__:%(filepath)s"
        };
        if (!AppendJavaScriptRuntimeArguments(arguments))
            EmitLog("warning", "Aucun runtime JavaScript compatible n'a été trouvé ; certains liens YouTube peuvent échouer.");
        AppendAuthenticationArguments(arguments, options);
        arguments.push_back(options.url);
        auto download = RunProcess(*ytDlp, arguments, temporary.path, [&](std::string const& line)
        {
            if (auto percent = ParseDownloadPercent(line)) EmitProgress("download", *percent);
            else if (line.starts_with("__MD_FILE__:"))
            {
                try { reportedPath = Utf8ToWide(line.substr(12)); } catch (...) {}
            }
            else if (!line.empty() && !line.starts_with("[download] Destination:"))
                EmitLog("info", line);
        }, g_cancelRequested);
        if (download.cancelled) { EmitError("cancelled", "Téléchargement annulé"); return 4; }
        if (download.exitCode != 0) { EmitError("download_failed", SummarizeDownloadFailure(download.output)); return 4; }

        auto source = !reportedPath.empty() && std::filesystem::is_regular_file(reportedPath)
            ? std::optional<std::filesystem::path>(reportedPath) : FindDownloadedFile(temporary.path);
        if (!source) { EmitError("download_failed", "Le fichier téléchargé est introuvable"); return 4; }

        std::filesystem::path completedSource = *source;
        if (options.maxSizeMb)
        {
            auto duration = ProbeDuration(*ffprobe, *source);
            auto plan = CalculateEncodePlan(duration, *options.maxSizeMb);
            if (!plan)
            {
                EmitError("size_unreachable", "La durée est trop importante pour la taille demandée");
                return 4;
            }
            completedSource = temporary.path / (source->stem().wstring() + L".compressed.mp4");
            Emit("{\"type\":\"encodingPlan\",\"durationSeconds\":" + std::to_string(duration) +
                ",\"videoKbps\":" + std::to_string(plan->videoKbps) + ",\"audioKbps\":" + std::to_string(plan->audioKbps) + "}");
            EncodeToSize(*ffmpeg, *source, completedSource, duration, *plan, options.quality);
            if (!std::filesystem::is_regular_file(completedSource))
                throw std::runtime_error("FFmpeg n'a pas produit le fichier attendu");
            auto maximumBytes = static_cast<std::uint64_t>(std::floor(*options.maxSizeMb * 1024.0 * 1024.0));
            auto encodedBytes = std::filesystem::file_size(completedSource);
            if (encodedBytes > maximumBytes)
            {
                EmitError("size_exceeded", "Le fichier encodé dépasse encore la taille maximale demandée");
                return 4;
            }
        }

        auto desiredName = completedSource.filename();
        if (options.maxSizeMb) desiredName = source->stem().wstring() + L".mp4";
        if (!options.title.empty()) desiredName = SanitizeFileName(options.title) + completedSource.extension().wstring();
        auto destination = UniqueDestination(output / desiredName, options.overwrite);
        MoveCompletedFile(completedSource, destination, options.overwrite);
        auto bytes = std::filesystem::file_size(destination);
        EmitProgress(options.maxSizeMb ? "encode" : "download", 100.0, options.maxSizeMb ? 2 : 0);
        Emit("{\"type\":\"completed\",\"path\":\"" + JsonEscape(WideToUtf8(destination.wstring())) +
            "\",\"bytes\":" + std::to_string(bytes) + "}");
        return 0;
    }

    void PrintHelp()
    {
        std::cout <<
            "MediaDownloader 0.1.0\n\n"
            "Usage:\n"
            "  MediaDownloader doctor [chemins des outils]\n"
            "  MediaDownloader probe --url URL\n"
            "  MediaDownloader download --url URL [options]\n\n"
            "Options:\n"
            "  --quality best|720|1080    Qualite ou hauteur maximale\n"
            "  --format mp4|mkv|webm      Conteneur final (mp4 par defaut)\n"
            "  --title TITRE               Nom personnalise du fichier final\n"
            "  --max-size-mb N            Taille maximale, en Mio\n"
            "  --cookies-from-browser NOM Utiliser auto, Firefox, Edge, Chrome…\n"
            "  --output DOSSIER           Dossier cible (Videos par defaut)\n"
            "  --overwrite                Remplacer un fichier homonyme\n"
            "  --yt-dlp CHEMIN            Chemin de yt-dlp.exe\n"
            "  --ffmpeg CHEMIN            Chemin de ffmpeg.exe\n"
            "  --ffprobe CHEMIN           Chemin de ffprobe.exe\n";
    }
}

int wmain(int argc, wchar_t* argv[])
{
    SetConsoleOutputCP(CP_UTF8);
    SetConsoleCtrlHandler(ConsoleHandler, TRUE);
    CoInitializeEx(nullptr, COINIT_MULTITHREADED);

    std::vector<std::wstring> arguments;
    for (int index = 1; index < argc; ++index) arguments.emplace_back(argv[index]);
    auto parsed = ParseArguments(arguments);
    if (!parsed.options)
    {
        EmitError("invalid_arguments", WideToUtf8(parsed.error));
        CoUninitialize();
        return 2;
    }

    int exitCode{};
    try
    {
        switch (parsed.options->command)
        {
        case Command::Help: PrintHelp(); break;
        case Command::Doctor: exitCode = RunDoctor(*parsed.options); break;
        case Command::Probe: exitCode = RunProbe(*parsed.options); break;
        case Command::Download: exitCode = RunDownload(*parsed.options); break;
        }
    }
    catch (std::exception const& error)
    {
        EmitError(g_cancelRequested ? "cancelled" : "processing_failed", error.what());
        exitCode = 4;
    }
    catch (...)
    {
        EmitError("processing_failed", "Une erreur inattendue est survenue");
        exitCode = 4;
    }
    CoUninitialize();
    return exitCode;
}
