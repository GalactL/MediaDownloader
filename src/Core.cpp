#include "Core.h"

#include <algorithm>
#include <charconv>
#include <chrono>
#include <fstream>
#include <cctype>
#include <cmath>
#include <cstdio>
#include <cwctype>
#include <limits>
#include <iomanip>
#include <locale>
#include <sstream>
#include <stdexcept>
#ifdef _WIN32
#include <windows.h>
#else
#include <codecvt>
#include <locale>
#endif

namespace media_downloader
{
    namespace
    {
        std::wstring Lower(std::wstring value)
        {
            std::transform(value.begin(), value.end(), value.begin(),
                [](wchar_t character) { return static_cast<wchar_t>(std::towlower(character)); });
            return value;
        }

        std::optional<double> ParsePositiveDouble(std::wstring const& value)
        {
            try
            {
                size_t consumed{};
                double parsed = std::stod(value, &consumed);
                if (consumed != value.size() || !std::isfinite(parsed) || parsed <= 0.0) return std::nullopt;
                return parsed;
            }
            catch (...) { return std::nullopt; }
        }

        std::optional<double> ParseNonNegativeDouble(std::wstring const& value)
        {
            try
            {
                size_t consumed{};
                double parsed = std::stod(value, &consumed);
                if (consumed != value.size() || !std::isfinite(parsed) || parsed < 0.0) return std::nullopt;
                return parsed;
            }
            catch (...) { return std::nullopt; }
        }

        bool IsResolution(std::wstring const& value)
        {
            if (value.empty()) return false;
            return std::all_of(value.begin(), value.end(), [](wchar_t character) { return std::iswdigit(character) != 0; });
        }

        bool IsSupportedBrowser(std::wstring const& value)
        {
            static std::vector<std::wstring> const browsers{
                L"auto", L"brave", L"chrome", L"chromium", L"edge", L"firefox", L"opera", L"vivaldi"
            };
            return std::find(browsers.begin(), browsers.end(), value) != browsers.end();
        }
    }

    bool IsNativeHostLaunch(std::vector<std::wstring> const& arguments)
    {
        if (arguments.empty()) return false;
        auto first = Lower(arguments[0]);
        if (first.empty() || first[0] == L'-' || first.find_first_of(L" \t") != std::wstring::npos) return false;
        if (first.size() > 5 && first.ends_with(L".json")) return true;
        auto at = first.find(L'@');
        if (at != std::wstring::npos && at > 0 && at + 1 < first.size()) return true;
        return first.size() > 2 && first.front() == L'{' && first.back() == L'}';
    }

    std::string BuildNativeManifest(std::string_view exePath, std::string_view extensionId)
    {
        return "{\n"
            "  \"name\": \"media_downloader\",\n"
            "  \"description\": \"MediaDownloader : télécharge et convertit des vidéos avec yt-dlp et FFmpeg.\",\n"
            "  \"path\": \"" + JsonEscape(exePath) + "\",\n"
            "  \"type\": \"stdio\",\n"
            "  \"allowed_extensions\": [\"" + JsonEscape(extensionId) + "\"]\n"
            "}\n";
    }

    std::filesystem::path NativeManifestPath(HostPlatform platform, std::filesystem::path const& home, std::filesystem::path const& exeDirectory)
    {
        switch (platform)
        {
        case HostPlatform::Windows: return exeDirectory / "native-host" / "media_downloader.json";
        default: return home / ".mozilla" / "native-messaging-hosts" / "media_downloader.json";
        }
    }

    ParseResult ParseArguments(std::vector<std::wstring> const& arguments)
    {
        Options result;
        if (arguments.empty() || arguments[0] == L"help" || arguments[0] == L"--help" || arguments[0] == L"-h")
        {
            result.command = Command::Help;
            return { result, {} };
        }

        auto command = Lower(arguments[0]);
        if (command == L"doctor") result.command = Command::Doctor;
        else if (command == L"probe") result.command = Command::Probe;
        else if (command == L"download") result.command = Command::Download;
        else if (command == L"install-host")
        {
            if (arguments.size() > 1) return { std::nullopt, L"install-host n'accepte aucun argument : " + arguments[1] };
            return { Options{ .command = Command::InstallHost }, {} };
        }
        else if (command == L"uninstall-host")
        {
            if (arguments.size() > 1) return { std::nullopt, L"uninstall-host n'accepte aucun argument : " + arguments[1] };
            return { Options{ .command = Command::UninstallHost }, {} };
        }
        else if (command == L"update")
        {
            if (arguments.size() > 1) return { std::nullopt, L"update n'accepte aucun argument : " + arguments[1] };
            return { Options{ .command = Command::Update }, {} };
        }
        else if (command == L"host") return { Options{ .command = Command::Host }, {} }; // Firefox appends extra argv: ignored
        else return { std::nullopt, L"Commande inconnue : " + arguments[0] };

        for (size_t index = 1; index < arguments.size(); ++index)
        {
            auto const& name = arguments[index];
            if (name == L"--overwrite")
            {
                result.overwrite = true;
                continue;
            }
            if (name == L"--low-resources")
            {
                result.lowResources = true;
                continue;
            }
            if (index + 1 >= arguments.size()) return { std::nullopt, L"Valeur manquante après " + name };
            auto const& value = arguments[++index];
            if (name == L"--url") result.url = value;
            else if (name == L"--output") result.outputDirectory = value;
            else if (name == L"--quality") result.quality = Lower(value);
            else if (name == L"--format") result.format = Lower(value);
            else if (name == L"--title") result.title = value;
            else if (name == L"--start-time")
            {
                auto parsed = ParseNonNegativeDouble(value);
                if (!parsed) return { std::nullopt, L"Le début de la plage doit être un nombre fini supérieur ou égal à 0." };
                result.startTimeSeconds = *parsed;
            }
            else if (name == L"--end-time")
            {
                auto parsed = ParseNonNegativeDouble(value);
                if (!parsed) return { std::nullopt, L"La fin de la plage doit être un nombre fini supérieur ou égal à 0." };
                result.endTimeSeconds = *parsed;
            }
            else if (name == L"--cookies-from-browser") result.cookiesFromBrowser = Lower(value);
            else if (name == L"--max-size-mb")
            {
                auto parsed = ParsePositiveDouble(value);
                if (!parsed) return { std::nullopt, L"La taille maximale doit être un nombre strictement positif." };
                result.maxSizeMb = *parsed;
            }
            else if (name == L"--yt-dlp") result.ytDlp = value;
            else if (name == L"--ffmpeg") result.ffmpeg = value;
            else if (name == L"--ffprobe") result.ffprobe = value;
            else return { std::nullopt, L"Option inconnue : " + name };
        }

        if ((result.command == Command::Probe || result.command == Command::Download) && result.url.empty())
            return { std::nullopt, L"L'option --url est obligatoire." };
        if (!result.url.empty() && !IsSupportedUrl(result.url))
            return { std::nullopt, L"Seules les URL HTTP et HTTPS sont acceptées." };
        if (result.quality != L"best" && !IsResolution(result.quality))
            return { std::nullopt, L"La qualité doit être best ou une hauteur telle que 720 ou 1080." };
        if (result.format != L"mp4" && result.format != L"mkv" && result.format != L"webm")
            return { std::nullopt, L"Le format doit être mp4, mkv ou webm." };
        if (result.maxSizeMb && result.format != L"mp4")
            return { std::nullopt, L"La limitation de taille produit actuellement un fichier MP4." };
        if (result.title.size() > 180)
            return { std::nullopt, L"Le titre personnalisé est limité à 180 caractères." };
        if (result.startTimeSeconds.has_value() != result.endTimeSeconds.has_value())
            return { std::nullopt, L"Les options --start-time et --end-time doivent être fournies ensemble." };
        if (result.startTimeSeconds && *result.endTimeSeconds <= *result.startTimeSeconds)
            return { std::nullopt, L"La fin de la plage doit être strictement supérieure au début." };
        if (result.cookiesFromBrowser && !IsSupportedBrowser(*result.cookiesFromBrowser))
            return { std::nullopt, L"Navigateur non pris en charge pour l'authentification." };
        return { result, {} };
    }

    bool IsSupportedUrl(std::wstring_view value)
    {
        auto lower = Lower(std::wstring(value));
        return lower.starts_with(L"https://") || lower.starts_with(L"http://");
    }

    std::optional<double> ParseFfmpegDuration(std::string_view output)
    {
        constexpr std::string_view key = "Duration:";
        auto at = output.find(key);
        if (at == std::string_view::npos) return std::nullopt;
        std::string text(output.substr(at + key.size(), 16));
        unsigned hours{}, minutes{};
        double seconds{};
        int consumed{};
        if (std::sscanf(text.c_str(), " %u:%u:%lf%n", &hours, &minutes, &seconds, &consumed) != 3) return std::nullopt;
        auto total = hours * 3600.0 + minutes * 60.0 + seconds;
        if (!std::isfinite(total) || total <= 0.0) return std::nullopt;
        return total;
    }

    static bool IsHostOrSubdomainOf(std::wstring_view value, std::initializer_list<std::wstring_view> domains)
    {
        auto lower = Lower(std::wstring(value));
        auto scheme = lower.find(L"://");
        if (scheme == std::wstring::npos) return false;
        auto authorityStart = scheme + 3;
        auto authorityEnd = lower.find_first_of(L"/?#", authorityStart);
        auto authority = lower.substr(authorityStart, authorityEnd - authorityStart);
        auto at = authority.rfind(L'@');
        if (at != std::wstring::npos) authority.erase(0, at + 1);
        auto colon = authority.find(L':');
        if (colon != std::wstring::npos) authority.resize(colon);
        auto isDomain = [&authority](std::wstring_view domain)
        {
            return authority == domain || (authority.size() > domain.size() &&
                authority.ends_with(domain) && authority[authority.size() - domain.size() - 1] == L'.');
        };
        return std::ranges::any_of(domains, isDomain);
    }

    bool IsYouTubeUrl(std::wstring_view value)
    {
        return IsHostOrSubdomainOf(value, { L"youtube.com", L"youtu.be", L"youtube-nocookie.com" });
    }

    bool IsTwitterUrl(std::wstring_view value)
    {
        return IsHostOrSubdomainOf(value, { L"x.com", L"twitter.com" });
    }

    std::wstring BuildFormatSelector(std::wstring const& quality)
    {
        if (quality == L"best") return L"bestvideo+bestaudio/best";
        return L"bestvideo[height<=" + quality + L"]+bestaudio/best[height<=" + quality + L"]/best";
    }

    std::wstring BuildDownloadSection(double startTimeSeconds, double endTimeSeconds)
    {
        auto format = [](double value)
        {
            std::wostringstream output;
            output.imbue(std::locale::classic());
            output << std::setprecision(std::numeric_limits<double>::max_digits10) << value;
            return output.str();
        };
        return L"*" + format(startTimeSeconds) + L"-" + format(endTimeSeconds);
    }

    std::wstring SanitizeFileName(std::wstring_view value)
    {
        std::wstring result;
        result.reserve(std::min<size_t>(value.size(), 140));
        for (wchar_t character : value)
        {
            if (result.size() >= 140) break;
            bool invalid = character < 32 || character == L'<' || character == L'>' || character == L':' ||
                character == L'"' || character == L'/' || character == L'\\' || character == L'|' ||
                character == L'?' || character == L'*';
            result.push_back(invalid ? L'_' : character);
        }
        auto first = result.find_first_not_of(L" .");
        if (first == std::wstring::npos) result.clear();
        else result.erase(0, first);
        while (!result.empty() && (result.back() == L' ' || result.back() == L'.')) result.pop_back();
        if (result.empty()) result = L"video";

        auto upper = result;
        std::transform(upper.begin(), upper.end(), upper.begin(), ::towupper);
        auto base = upper.substr(0, upper.find(L'.'));
        static std::vector<std::wstring> const reserved{
            L"CON", L"PRN", L"AUX", L"NUL", L"COM1", L"COM2", L"COM3", L"COM4", L"COM5",
            L"COM6", L"COM7", L"COM8", L"COM9", L"LPT1", L"LPT2", L"LPT3", L"LPT4",
            L"LPT5", L"LPT6", L"LPT7", L"LPT8", L"LPT9"
        };
        if (std::find(reserved.begin(), reserved.end(), base) != reserved.end()) result.insert(result.begin(), L'_');
        return result;
    }

    std::string SummarizeDownloadFailure(std::string_view output)
    {
        std::string text(output);
        auto lower = text;
        std::transform(lower.begin(), lower.end(), lower.begin(),
            [](unsigned char character) { return static_cast<char>(std::tolower(character)); });

        if (lower.find("could not copy") != std::string::npos && lower.find("cookie") != std::string::npos)
            return "Impossible de lire les cookies du navigateur. Fermez complètement le navigateur sélectionné, puis réessayez.";
        if (lower.find("failed to decrypt with dpapi") != std::string::npos ||
            ((lower.find("decrypt") != std::string::npos || lower.find("dpapi") != std::string::npos) &&
                lower.find("cookie") != std::string::npos))
            return "Windows n'a pas pu déchiffrer les cookies de ce navigateur Chromium. Utilisez de préférence Firefox connecté à YouTube, puis fermez-le avant de réessayer.";
        if (lower.find("sign in to confirm your age") != std::string::npos ||
            lower.find("confirm your age") != std::string::npos)
            return "YouTube n'a pas reconnu une session autorisée pour cette vidéo. Vérifiez le navigateur sélectionné et l'âge du compte.";
        if (lower.find("sign in to confirm you're not a bot") != std::string::npos ||
            lower.find("sign in to confirm you’re not a bot") != std::string::npos)
            return "YouTube demande une session connectée valide. Sélectionnez le navigateur où YouTube est ouvert avec votre compte.";
        if (lower.find("requested format is not available") != std::string::npos)
            return "La qualité ou le format demandé n'est pas disponible pour cette vidéo. Essayez la qualité Best.";
        if (lower.find("video unavailable") != std::string::npos)
            return "Cette vidéo est indisponible pour le compte ou la région actuellement utilisés.";
        if (lower.find("challenge solving failed") != std::string::npos || lower.find("page needs to be reloaded") != std::string::npos)
            return "Le challenge JavaScript de YouTube n'a pas pu être résolu. Vérifiez qu'un runtime Node ou Deno récent est disponible.";

        std::string lastError;
        size_t start{};
        while (start <= text.size())
        {
            auto end = text.find('\n', start);
            auto line = text.substr(start, end == std::string::npos ? std::string::npos : end - start);
            if (!line.empty() && line.back() == '\r') line.pop_back();
            if (line.starts_with("ERROR:")) lastError = line.substr(6);
            if (end == std::string::npos) break;
            start = end + 1;
        }
        auto first = lastError.find_first_not_of(" \t");
        if (first != std::string::npos) lastError.erase(0, first);
        return lastError.empty() ? "yt-dlp n'a pas pu télécharger cette vidéo." : lastError;
    }

    std::optional<EncodePlan> CalculateEncodePlan(double durationSeconds, double maxSizeMb)
    {
        if (!std::isfinite(durationSeconds) || !std::isfinite(maxSizeMb) || durationSeconds <= 0.0 || maxSizeMb <= 0.0)
            return std::nullopt;

        // MiB correspond à la taille affichée par Windows. Une réserve de 3 % couvre le conteneur.
        auto targetBytesDouble = maxSizeMb * 1024.0 * 1024.0 * 0.97;
        if (targetBytesDouble > static_cast<double>(std::numeric_limits<std::uint64_t>::max())) return std::nullopt;
        auto totalKbps = targetBytesDouble * 8.0 / durationSeconds / 1000.0;

        std::uint32_t audioKbps = totalKbps >= 320.0 ? 128u : (totalKbps >= 200.0 ? 96u : 48u);
        constexpr std::uint32_t minimumVideoKbps = 80;
        if (totalKbps <= static_cast<double>(audioKbps + minimumVideoKbps)) return std::nullopt;

        return EncodePlan{
            static_cast<std::uint64_t>(std::floor(targetBytesDouble)),
            audioKbps,
            static_cast<std::uint32_t>(std::floor(totalKbps - audioKbps))
        };
    }

    std::vector<std::wstring> BuildEncodeArguments(
        std::filesystem::path const& source, std::filesystem::path const& destination, std::filesystem::path const& passLog,
        std::uint32_t videoKbps, std::uint32_t audioKbps, std::wstring const& quality, int pass, bool lowResources)
    {
        std::vector<std::wstring> arguments{
            L"-y", L"-i", source.wstring(), L"-map", L"0:v:0", L"-c:v", L"libx264",
            L"-preset", L"medium", L"-b:v", std::to_wstring(videoKbps) + L"k", L"-pass", std::to_wstring(pass),
            L"-passlogfile", passLog.wstring()
        };
        if (lowResources) arguments.insert(arguments.end(), { L"-threads", L"2" });
        arguments.insert(arguments.end(), { L"-progress", L"pipe:1", L"-nostats" });
        if (quality != L"best")
            arguments.insert(arguments.begin() + 5, { L"-vf", L"scale=-2:min(ih\\," + quality + L")" });
        if (pass == 1)
        {
            arguments.insert(arguments.end(), { L"-an", L"-f", L"null",
#ifdef _WIN32
                L"NUL"
#else
                L"/dev/null"
#endif
            });
        }
        else
        {
            arguments.insert(arguments.end(), {
                L"-map", L"0:a:0?", L"-c:a", L"aac", L"-b:a", std::to_wstring(audioKbps) + L"k",
                L"-movflags", L"+faststart", destination.wstring()
            });
        }
        return arguments;
    }

    namespace
    {
        constexpr std::string_view ProgressPrefix = "__MD_PROGRESS__:";
        constexpr std::string_view PostprocessPrefix = "__MD_POST__:";

        std::vector<std::string_view> SplitPipe(std::string_view text)
        {
            std::vector<std::string_view> fields;
            for (size_t start = 0;;)
            {
                auto bar = text.find('|', start);
                fields.push_back(text.substr(start, bar == std::string_view::npos ? bar : bar - start));
                if (bar == std::string_view::npos) return fields;
                start = bar + 1;
            }
        }

        // "NA" (yt-dlp's marker for a missing field), empty or non-numeric -> nullopt.
        std::optional<double> ParseField(std::string_view text)
        {
            if (text.empty() || text == "NA") return std::nullopt;
            try
            {
                std::string copy(text);
                size_t consumed{};
                double value = std::stod(copy, &consumed);
                if (consumed != copy.size() || !std::isfinite(value) || value < 0.0) return std::nullopt;
                return value;
            }
            catch (...) { return std::nullopt; }
        }
    }

    std::optional<DownloadProgressLine> ParseDownloadProgressLine(std::string_view line)
    {
        if (!line.starts_with(ProgressPrefix)) return std::nullopt;
        // status|downloaded_bytes|total_bytes|total_bytes_estimate|fragment_index|fragment_count|format_id
        auto fields = SplitPipe(line.substr(ProgressPrefix.size()));
        if (fields.size() != 7 || fields[0].empty()) return std::nullopt;
        DownloadProgressLine result;
        result.status = std::string(fields[0]);
        result.downloadedBytes = ParseField(fields[1]);
        result.totalBytes = ParseField(fields[2]);
        if (!result.totalBytes) result.totalBytes = ParseField(fields[3]);
        result.fragmentIndex = ParseField(fields[4]);
        result.fragmentCount = ParseField(fields[5]);
        if (fields[6] != "NA") result.formatId = std::string(fields[6]);
        return result;
    }

    std::optional<std::string> ParsePostprocessorStart(std::string_view line)
    {
        if (!line.starts_with(PostprocessPrefix)) return std::nullopt;
        auto fields = SplitPipe(line.substr(PostprocessPrefix.size()));
        if (fields.size() != 2 || fields[0] != "started" || fields[1].empty()) return std::nullopt;
        return std::string(fields[1]);
    }

    std::optional<double> DownloadProgressSmoother::Update(DownloadProgressLine const& line)
    {
        if (started_ && line.formatId != formatId_) ++stream_;
        started_ = true;
        formatId_ = line.formatId;

        std::optional<double> fraction;
        if (line.status == "finished") fraction = 1.0;
        else if (line.downloadedBytes && line.totalBytes && *line.totalBytes > 0.0) fraction = *line.downloadedBytes / *line.totalBytes;
        else if (line.fragmentIndex && line.fragmentCount && *line.fragmentCount > 0.0) fraction = *line.fragmentIndex / *line.fragmentCount;
        if (!fraction) return std::nullopt;

        auto within = std::clamp(*fraction, 0.0, 1.0);
        auto percent = stream_ == 0 ? within * 85.0 : 85.0 + within * 15.0;
        last_ = std::max(last_, percent);
        return last_;
    }

    std::string JsonEscape(std::string_view value)
    {
        std::string output;
        output.reserve(value.size() + 8);
        constexpr char hex[] = "0123456789abcdef";
        for (unsigned char character : value)
        {
            switch (character)
            {
            case '"': output += "\\\""; break;
            case '\\': output += "\\\\"; break;
            case '\b': output += "\\b"; break;
            case '\f': output += "\\f"; break;
            case '\n': output += "\\n"; break;
            case '\r': output += "\\r"; break;
            case '\t': output += "\\t"; break;
            default:
                if (character < 0x20)
                {
                    output += "\\u00";
                    output += hex[(character >> 4) & 0x0f];
                    output += hex[character & 0x0f];
                }
                else output.push_back(static_cast<char>(character));
            }
        }
        return output;
    }

    std::string WideToUtf8(std::wstring_view value)
    {
        if (value.empty()) return {};
#ifdef _WIN32
        auto count = WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
        if (count <= 0) throw std::runtime_error("Conversion UTF-8 impossible");
        std::string output(static_cast<size_t>(count), '\0');
        WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), output.data(), count, nullptr, nullptr);
        return output;
#else
        std::wstring_convert<std::codecvt_utf8<wchar_t>> converter;
        return converter.to_bytes(value.data(), value.data() + value.size());
#endif
    }

    std::wstring Utf8ToWide(std::string_view value)
    {
        if (value.empty()) return {};
#ifdef _WIN32
        auto count = MultiByteToWideChar(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0);
        if (count <= 0) throw std::runtime_error("Conversion UTF-16 impossible");
        std::wstring output(static_cast<size_t>(count), L'\0');
        MultiByteToWideChar(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), output.data(), count);
        return output;
#else
        std::wstring_convert<std::codecvt_utf8<wchar_t>> converter;
        return converter.from_bytes(value.data(), value.data() + value.size());
#endif
    }

    bool EnsureOutputDirectory(std::filesystem::path const& requested, std::filesystem::path& resolved)
    {
        std::error_code error;
        resolved = std::filesystem::absolute(requested, error);
        if (error) return false;
        std::filesystem::create_directories(resolved, error);
        if (error) return false;
        // create_directories renvoie false sans erreur si le chemin existe déjà, y compris comme fichier.
        if (!std::filesystem::is_directory(resolved, error) || error) return false;
        // Sondage d'écriture : un dossier existant peut être en lecture seule ou refuser la création de fichiers.
        auto const probe = resolved / (L".mediadownloader-probe-" + std::to_wstring(std::chrono::steady_clock::now().time_since_epoch().count()));
        bool written;
        {
            std::ofstream file(probe, std::ios::binary | std::ios::trunc);
            file.put('x');
            file.flush();
            written = file.good();
        }
        std::filesystem::remove(probe, error);
        return written;
    }
}
