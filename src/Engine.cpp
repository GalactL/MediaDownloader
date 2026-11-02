#include "Engine.h"
#include "ChildProcess.h"
#include "TemporaryFiles.h"

#ifdef _WIN32
#include <windows.h>
#include <shlobj.h>
#else
#include <unistd.h>
#endif

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <sstream>

namespace media_downloader
{
namespace
{
    struct Ctx
    {
        EventSink& sink;
        std::atomic_bool const& cancel;
        void Log(std::string const& level, std::string const& message) const { sink.On(LogEvent{ level, message }); }
        void Error(std::string const& code, std::string const& message) const { sink.On(ErrorEvent{ code, message }); }
        void Progress(std::string const& stage, double percent, int pass = 0) const
        {
            sink.On(ProgressEvent{ stage, std::clamp(percent, 0.0, 100.0), pass });
        }
        // Phase-only event: the stage is known, the percentage is not.
        void Phase(std::string const& stage) const { sink.On(PhaseEvent{ stage }); }
    };

#ifdef _WIN32
    constexpr wchar_t YtDlpName[] = L"yt-dlp.exe";
    constexpr wchar_t FfmpegName[] = L"ffmpeg.exe";
    constexpr wchar_t DenoName[] = L"deno.exe";
    constexpr wchar_t NodeName[] = L"node.exe";
#else
    constexpr wchar_t YtDlpName[] = L"yt-dlp";
    constexpr wchar_t FfmpegName[] = L"ffmpeg";
    constexpr wchar_t DenoName[] = L"deno";
    constexpr wchar_t NodeName[] = L"node";
#endif
    std::filesystem::path ExecutablePath()
    {
#ifdef _WIN32
        std::wstring buffer(32768, L'\0');
        auto length = GetModuleFileNameW(nullptr, buffer.data(), static_cast<DWORD>(buffer.size()));
        buffer.resize(length);
        return std::filesystem::path(buffer);
#else
        std::array<char, 4096> buffer{};
        auto length = readlink("/proc/self/exe", buffer.data(), buffer.size() - 1);
        if (length <= 0) return std::filesystem::current_path() / "MediaDownloader.Cli";
        return std::filesystem::path(std::string(buffer.data(), static_cast<size_t>(length)));
#endif
    }

    std::filesystem::path ExecutableDirectory() { return ExecutablePath().parent_path(); }

    std::optional<std::filesystem::path> FromEnvironment(wchar_t const* name)
    {
#ifdef _WIN32
        auto required = GetEnvironmentVariableW(name, nullptr, 0);
        if (required == 0) return std::nullopt;
        std::wstring value(required, L'\0');
        GetEnvironmentVariableW(name, value.data(), required);
        if (!value.empty() && value.back() == L'\0') value.pop_back();
        if (!value.empty() && std::filesystem::is_regular_file(value)) return std::filesystem::path(value);
        return std::nullopt;
#else
        auto utf8Name = WideToUtf8(name);
        auto value = std::getenv(utf8Name.c_str());
        if (value && std::filesystem::is_regular_file(value)) return std::filesystem::path(value);
        return std::nullopt;
#endif
    }

    std::optional<std::filesystem::path> FindOnPath(std::wstring const& filename)
    {
#ifdef _WIN32
        std::wstring buffer(32768, L'\0');
        auto length = SearchPathW(nullptr, filename.c_str(), nullptr, static_cast<DWORD>(buffer.size()), buffer.data(), nullptr);
        if (length == 0 || length >= buffer.size()) return std::nullopt;
        buffer.resize(length);
        return std::filesystem::path(buffer);
#else
        auto path = std::getenv("PATH");
        if (!path) return std::nullopt;
        std::stringstream entries(path);
        std::string directory;
        auto utf8Filename = WideToUtf8(filename);
        while (std::getline(entries, directory, ':'))
        {
            auto candidate = std::filesystem::path(directory) / utf8Filename;
            if (access(candidate.c_str(), X_OK) == 0) return std::filesystem::absolute(candidate);
        }
        return std::nullopt;
#endif
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
            ExecutableDirectory() / filename
        };
        for (auto const& candidate : candidates)
            if (std::filesystem::is_regular_file(candidate)) return std::filesystem::absolute(candidate);
        return FindOnPath(filename);
    }

    std::filesystem::path VideosDirectory()
    {
#ifdef _WIN32
        PWSTR raw{};
        if (FAILED(SHGetKnownFolderPath(FOLDERID_Videos, KF_FLAG_CREATE, nullptr, &raw)))
            throw std::runtime_error("Le dossier Windows Vidéos est indisponible");
        std::filesystem::path result(raw);
        CoTaskMemFree(raw);
        return result;
#else
        auto home = std::getenv("HOME");
        if (!home) throw std::runtime_error("Le dossier personnel est indisponible");
        auto result = std::filesystem::path(home) / "Videos";
        std::filesystem::create_directories(result);
        return result;
#endif
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
        auto deno = FindTool(std::nullopt, L"MEDIADOWNLOADER_DENO", DenoName);
        if (deno)
        {
            arguments.insert(arguments.end(), { L"--js-runtimes", L"deno:" + deno->wstring() });
            return deno;
        }
        auto node = FindTool(std::nullopt, L"MEDIADOWNLOADER_NODE", NodeName);
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
        Ctx const* context{};
        ~TemporaryDirectory()
        {
            if (!path.empty())
            {
                std::error_code error;
                std::filesystem::remove_all(path, error);
                if (error) context->Log("warning", "Impossible de supprimer le dossier temporaire " +
                    WideToUtf8(path.wstring()) + " : " + error.message());
            }
        }
    };

    TemporaryDirectory CreateTemporaryDirectory(Ctx const& c, std::filesystem::path const& output)
    {
        auto ticks = std::chrono::steady_clock::now().time_since_epoch().count();
#ifdef _WIN32
        auto processId = GetCurrentProcessId();
#else
        auto processId = getpid();
#endif
        auto path = output / (L".mediadownloader-" + std::to_wstring(processId) + L"-" + std::to_wstring(ticks));
        std::filesystem::create_directories(path);
        return { path, &c };
    }

    // `ffmpeg -i` without output exits non-zero but prints the Duration line, so the exit code is ignored.
    double ProbeDuration(Ctx const& c, std::filesystem::path const& ffmpeg, std::filesystem::path const& source)
    {
        auto result = RunProcess(ffmpeg, { L"-hide_banner", L"-i", source.wstring() }, source.parent_path(), {}, c.cancel);
        if (result.cancelled) throw std::runtime_error("Traitement annulé");
        auto duration = ParseFfmpegDuration(result.output);
        if (!duration) throw std::runtime_error("FFmpeg n'a pas pu déterminer la durée de la vidéo");
        return *duration;
    }

    void EncodeToSize(
        Ctx const& c,
        std::filesystem::path const& ffmpeg,
        std::filesystem::path const& source,
        std::filesystem::path const& destination,
        double duration,
        EncodePlan const& plan,
        std::wstring const& quality,
        bool lowResources)
    {
        auto passLog = source.parent_path() / L"ffmpeg-pass";
        for (int pass = 1; pass <= 2; ++pass)
        {
            auto arguments = BuildEncodeArguments(source, destination, passLog, plan.videoKbps, plan.audioKbps, quality, pass, lowResources);
            c.Progress("encode", (pass - 1) * 50.0, pass); // announces the pass before FFmpeg's first progress line
            auto result = RunProcess(ffmpeg, arguments, source.parent_path(), [&c, duration, pass](std::string const& line)
            {
                if (!line.starts_with("out_time_us=")) return;
                try
                {
                    auto microseconds = std::stod(line.substr(12));
                    auto passPercent = microseconds / (duration * 1'000'000.0) * 100.0;
                    auto overall = (pass - 1) * 50.0 + std::clamp(passPercent, 0.0, 100.0) * 0.5;
                    c.Progress("encode", overall, pass);
                }
                catch (...) {}
            }, c.cancel, lowResources ? ProcessPriority::Low : ProcessPriority::Normal);
            if (result.cancelled) throw std::runtime_error("Traitement annulé");
            if (result.exitCode != 0) throw std::runtime_error("FFmpeg a échoué pendant l'encodage passe " + std::to_string(pass));
        }
    }

    int RunDoctor(Ctx const& c, Options const& options)
    {
        auto ytDlp = FindTool(options.ytDlp, L"MEDIADOWNLOADER_YTDLP", YtDlpName);
        auto ffmpeg = FindTool(options.ffmpeg, L"MEDIADOWNLOADER_FFMPEG", FfmpegName);
        std::vector<std::wstring> runtimeArguments;
        auto jsRuntime = AppendJavaScriptRuntimeArguments(runtimeArguments);
        auto tool = [](auto const& path)
        {
            return DoctorTool{ path.has_value(), path ? WideToUtf8(path->wstring()) : std::string{} };
        };
        c.sink.On(DoctorEvent{ tool(ytDlp), tool(ffmpeg), tool(jsRuntime) });
        // The JS runtime only matters for YouTube; without a YouTube URL it is reported but not required.
        return ytDlp && ffmpeg && (jsRuntime || !IsYouTubeUrl(options.url)) ? 0 : 3;
    }

    int RunProbe(Ctx const& c, Options const& options)
    {
        auto ytDlp = FindTool(options.ytDlp, L"MEDIADOWNLOADER_YTDLP", YtDlpName);
        if (!ytDlp) { c.Error("tool_missing", "yt-dlp est introuvable"); return 3; }
        std::vector<std::wstring> arguments{ L"--dump-single-json", L"--no-playlist", L"--no-warnings", L"--quiet" };
        AppendJavaScriptRuntimeArguments(arguments);
        AppendAuthenticationArguments(arguments, options);
        arguments.push_back(options.url);
        auto result = RunProcess(*ytDlp, arguments,
            std::filesystem::current_path(), {}, c.cancel);
        if (result.cancelled) { c.Error("cancelled", "Inspection annulée"); return 4; }
        auto payload = Trim(result.output);
        if (result.exitCode != 0 || payload.empty() || payload.front() != '{')
        {
            c.Error("probe_failed", payload.empty() ? "yt-dlp n'a retourné aucune information" : payload);
            return 4;
        }
        c.sink.On(ProbeEvent{ payload });
        return 0;
    }

    int RunDownload(Ctx const& c, Options const& options)
    {
        auto ytDlp = FindTool(options.ytDlp, L"MEDIADOWNLOADER_YTDLP", YtDlpName);
        if (!ytDlp) { c.Error("tool_missing", "yt-dlp est introuvable"); return 3; }

        auto ffmpeg = FindTool(options.ffmpeg, L"MEDIADOWNLOADER_FFMPEG", FfmpegName);
        if (!ffmpeg)
        {
            c.Error("tool_missing", "ffmpeg.exe est requis pour assembler les flux vidéo et audio");
            return 3;
        }

        std::filesystem::path output;
        auto const& requested = options.outputDirectory;
        if (requested.empty() || !EnsureOutputDirectory(requested, output))
        {
            // Un dossier demandé inutilisable ne fait pas échouer le téléchargement : repli sur le dossier Vidéos.
            std::filesystem::path videos;
            try { videos = VideosDirectory(); } catch (...) {}
            if (videos.empty() || !EnsureOutputDirectory(videos, output))
            {
                c.Error("invalid_output_directory", "Le dossier Vidéos est inutilisable (ce n'est pas un dossier, il ne peut pas être créé ou il n'est pas accessible en écriture) : " + WideToUtf8(videos.wstring()));
                return 4;
            }
            if (!requested.empty())
                c.Log("warning", "Dossier de sortie inutilisable (" + WideToUtf8(requested.wstring()) + "), enregistrement dans le dossier Vidéos : " + WideToUtf8(output.wstring()));
        }
        auto cleanup = CleanupOrphanedTemporaryDirectories(output);
        for (auto const& removed : cleanup.removed)
            c.Log("info", "Dossier temporaire orphelin supprimé : " + WideToUtf8(removed.wstring()));
        for (auto const& [path, error] : cleanup.failures)
            c.Log("warning", "Impossible de nettoyer " + WideToUtf8(path.wstring()) + " : " + error);
        auto temporary = CreateTemporaryDirectory(c, output);
        c.sink.On(StartedEvent{ WideToUtf8(output.wstring()) });
        c.Phase("inspection");

        std::filesystem::path reportedPath;
        std::vector<std::wstring> arguments{
            L"--newline", L"--no-color", L"--no-playlist", L"--windows-filenames", L"--no-overwrites",
            L"--format", BuildFormatSelector(options.quality),
            L"--ffmpeg-location", ffmpeg->parent_path().wstring(),
            L"--merge-output-format", options.format,
            L"--output", (temporary.path / L"%(title).180B [%(id)s].%(ext)s").wstring(),
            // --print implies --quiet, which also silences the progress lines: --progress brings them back and the
            // templates give them a stable, parseable shape (ParseDownloadProgressLine / ParsePostprocessorStart).
            L"--progress",
            L"--progress-template", L"download:__MD_PROGRESS__:%(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|"
                L"%(progress.total_bytes_estimate)s|%(progress.fragment_index)s|%(progress.fragment_count)s|%(info.format_id)s",
            L"--progress-template", L"postprocess:__MD_POST__:%(progress.status)s|%(progress.postprocessor)s",
            L"--print", L"before_dl:__MD_DL__:%(id)s",
            L"--print", L"after_move:__MD_FILE__:%(filepath)s"
        };
        if (!AppendJavaScriptRuntimeArguments(arguments) && IsYouTubeUrl(options.url))
            c.Log("warning", "Aucun runtime JavaScript compatible n'a été trouvé ; certains liens YouTube peuvent échouer.");
        AppendAuthenticationArguments(arguments, options);
        // yt-dlp renvoie [vidéos du tweet..., vidéos du tweet cité] même avec --no-playlist : on ne garde que la première.
        if (IsTwitterUrl(options.url)) arguments.insert(arguments.end(), { L"--playlist-items", L"1" });
        if (options.startTimeSeconds && options.endTimeSeconds)
        {
            arguments.insert(arguments.end(), {
                L"--download-sections", BuildDownloadSection(*options.startTimeSeconds, *options.endTimeSeconds),
                L"--force-keyframes-at-cuts"
            });
        }
        arguments.push_back(options.url);
        DownloadProgressSmoother smoother;
        std::string stage = "inspection";
        long lastTenth = -1;
        auto enter = [&](char const* next) { if (stage != next) { stage = next; c.Phase(stage); } };
        auto download = RunProcess(*ytDlp, arguments, temporary.path, [&](std::string const& line)
        {
            if (auto progress = ParseDownloadProgressLine(line))
            {
                if (auto percent = smoother.Update(*progress))
                {
                    stage = "download";
                    // One event per 0.1 % at most: yt-dlp reports far more often than a UI can use.
                    if (auto tenth = std::lround(*percent * 10.0); tenth != lastTenth) { lastTenth = tenth; c.Progress(stage, *percent); }
                }
                else enter("download");
            }
            else if (line.starts_with("__MD_DL__:")) enter("download"); // metadata done, the transfer starts
            else if (line.starts_with("__MD_POST__:"))
            {
                if (auto name = ParsePostprocessorStart(line); name && *name == "Merger") enter("merge");
            }
            else if (line.starts_with("__MD_FILE__:"))
            {
                try { reportedPath = Utf8ToWide(line.substr(12)); } catch (...) {}
            }
            else if (!line.empty() && !line.starts_with("[download] Destination:"))
                c.Log("info", line);
        }, c.cancel);
        if (download.cancelled) { c.Error("cancelled", "Téléchargement annulé"); return 4; }
        if (download.exitCode != 0) { c.Error("download_failed", SummarizeDownloadFailure(download.output)); return 4; }

        auto source = !reportedPath.empty() && std::filesystem::is_regular_file(reportedPath)
            ? std::optional<std::filesystem::path>(reportedPath) : FindDownloadedFile(temporary.path);
        if (!source) { c.Error("download_failed", "Le fichier téléchargé est introuvable"); return 4; }

        std::filesystem::path completedSource = *source;
        if (options.maxSizeMb)
        {
            auto duration = ProbeDuration(c, *ffmpeg, *source);
            auto plan = CalculateEncodePlan(duration, *options.maxSizeMb);
            if (!plan)
            {
                c.Error("size_unreachable", "La durée est trop importante pour la taille demandée");
                return 4;
            }
            completedSource = temporary.path / (source->stem().wstring() + L".compressed.mp4");
            c.sink.On(EncodingPlanEvent{ duration, plan->videoKbps, plan->audioKbps });
            EncodeToSize(c, *ffmpeg, *source, completedSource, duration, *plan, options.quality, options.lowResources);
            if (!std::filesystem::is_regular_file(completedSource))
                throw std::runtime_error("FFmpeg n'a pas produit le fichier attendu");
            auto maximumBytes = static_cast<std::uint64_t>(std::floor(*options.maxSizeMb * 1024.0 * 1024.0));
            auto encodedBytes = std::filesystem::file_size(completedSource);
            if (encodedBytes > maximumBytes)
            {
                c.Error("size_exceeded", "Le fichier encodé dépasse encore la taille maximale demandée");
                return 4;
            }
        }

        auto desiredName = completedSource.filename();
        if (options.maxSizeMb) desiredName = source->stem().wstring() + L".mp4";
        if (!options.title.empty()) desiredName = SanitizeFileName(options.title) + completedSource.extension().wstring();
        auto destination = UniqueDestination(output / desiredName, options.overwrite);
        MoveCompletedFile(completedSource, destination, options.overwrite);
        auto bytes = std::filesystem::file_size(destination);
        c.Progress(options.maxSizeMb ? "encode" : "download", 100.0, options.maxSizeMb ? 2 : 0);
        c.sink.On(CompletedEvent{ WideToUtf8(destination.wstring()), bytes });
        return 0;
    }
}

int Engine::Doctor(Options const& options) { return RunDoctor(Ctx{ sink_, cancel_ }, options); }
int Engine::Probe(Options const& options) { return RunProbe(Ctx{ sink_, cancel_ }, options); }
int Engine::Download(Options const& options) { return RunDownload(Ctx{ sink_, cancel_ }, options); }

int Engine::Update(Options const& options)
{
    Ctx c{ sink_, cancel_ };
    auto ytDlp = FindTool(options.ytDlp, L"MEDIADOWNLOADER_YTDLP", YtDlpName);
    if (!ytDlp) { c.Error("tool_missing", "yt-dlp est introuvable"); return 3; }
    auto result = RunProcess(*ytDlp, { L"-U" }, std::filesystem::current_path(), [&c](std::string const& line)
    {
        if (!Trim(line).empty()) c.Log("info", line);
    }, cancel_);
    if (result.cancelled) { c.Error("cancelled", "Mise à jour annulée"); return 4; }
    if (result.exitCode != 0) { c.Error("update_failed", "La mise à jour de yt-dlp a échoué"); return 4; }
    return 0;
}

namespace
{
void WriteManifest(std::filesystem::path const& manifest, std::string const& content)
{
    std::error_code error;
    std::filesystem::create_directories(manifest.parent_path(), error);
    if (error) throw std::runtime_error("Impossible de créer le dossier du manifeste : " + error.message());
    std::ofstream file(manifest, std::ios::binary | std::ios::trunc);
    file << content;
    file.flush();
    if (!file) throw std::runtime_error("Impossible d'écrire le manifeste : " + WideToUtf8(manifest.wstring()));
}

#ifdef _WIN32
void SetHostRegistryKey(std::wstring const& keyPath, std::wstring const& value)
{
    HKEY key{};
    if (RegCreateKeyExW(HKEY_CURRENT_USER, keyPath.c_str(), 0, nullptr, 0, KEY_SET_VALUE, nullptr, &key, nullptr) != ERROR_SUCCESS)
        throw std::runtime_error("Impossible de créer la clé de registre de l'hôte natif");
    auto status = RegSetValueExW(key, nullptr, 0, REG_SZ, reinterpret_cast<BYTE const*>(value.c_str()),
        static_cast<DWORD>((value.size() + 1) * sizeof(wchar_t)));
    RegCloseKey(key);
    if (status != ERROR_SUCCESS) throw std::runtime_error("Impossible d'écrire la clé de registre de l'hôte natif");
}

// true si la clé existait et a été supprimée.
bool DeleteHostRegistryKey(std::wstring const& keyPath)
{
    auto status = RegDeleteKeyW(HKEY_CURRENT_USER, keyPath.c_str());
    if (status != ERROR_SUCCESS && status != ERROR_FILE_NOT_FOUND)
        throw std::runtime_error("Impossible de supprimer la clé de registre de l'hôte natif");
    return status == ERROR_SUCCESS;
}
#endif

std::filesystem::path HomeDirectory()
{
#ifdef _WIN32
    return {};
#else
    std::filesystem::path home;
    if (auto value = std::getenv("HOME")) home = value;
    if (home.empty()) throw std::runtime_error("Le dossier personnel est indisponible");
    return home;
#endif
}

#ifdef _WIN32
constexpr auto CurrentPlatform = HostPlatform::Windows;
#else
constexpr auto CurrentPlatform = HostPlatform::Linux;
#endif
}

int Engine::InstallHost()
{
    constexpr char ExtensionId[] = "mediadownloader@localhost";
    auto exe = ExecutablePath();
    auto exeUtf8 = exe.u8string();
    auto exeText = std::string(exeUtf8.begin(), exeUtf8.end());
    auto home = HomeDirectory();
    auto manifest = NativeManifestPath(CurrentPlatform, home, exe.parent_path());
    WriteManifest(manifest, BuildNativeManifest(exeText, ExtensionId));
    auto chromiumManifests = ChromiumManifestPaths(CurrentPlatform, home, exe.parent_path());
    for (auto const& path : chromiumManifests) WriteManifest(path, BuildChromiumNativeManifest(exeText));
#ifdef _WIN32
    SetHostRegistryKey(L"Software\\Mozilla\\NativeMessagingHosts\\media_downloader", manifest.wstring());
    for (auto const& key : ChromiumRegistryKeys()) SetHostRegistryKey(key, chromiumManifests.front().wstring());
#endif
    std::cerr << "Hôte natif installé : " << WideToUtf8(manifest.wstring()) << std::endl;
    for (auto const& path : chromiumManifests) std::cerr << "Hôte natif Chromium installé : " << WideToUtf8(path.wstring()) << std::endl;
    return 0;
}

int Engine::UninstallHost()
{
    auto exeDirectory = ExecutablePath().parent_path();
    auto home = HomeDirectory();
    auto manifest = NativeManifestPath(CurrentPlatform, home, exeDirectory);
    auto paths = ChromiumManifestPaths(CurrentPlatform, home, exeDirectory);
    paths.insert(paths.begin(), manifest);
    bool removed = false;
    for (auto const& path : paths)
    {
        std::error_code error;
        auto gone = std::filesystem::remove(path, error);
        if (error) throw std::runtime_error("Impossible de supprimer le manifeste : " + error.message());
        removed = removed || gone;
    }
#ifdef _WIN32
    auto keys = ChromiumRegistryKeys();
    keys.push_back(L"Software\\Mozilla\\NativeMessagingHosts\\media_downloader");
    for (auto const& key : keys) removed = DeleteHostRegistryKey(key) || removed;
#endif
    std::cerr << (removed ? "Hôte natif retiré : " : "Hôte natif déjà absent : ") << WideToUtf8(manifest.wstring()) << std::endl;
    return 0;
}
}
