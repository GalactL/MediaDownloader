#pragma once

#include <cstdint>
#include <filesystem>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace media_downloader
{
    enum class Command
    {
        Help,
        Doctor,
        Probe,
        Download,
        Host,
        InstallHost,
        Update,
        UninstallHost
    };

    enum class HostPlatform { Windows, Linux };

    struct Options
    {
        Command command{ Command::Help };
        std::wstring url;
        std::filesystem::path outputDirectory;
        std::wstring quality{ L"best" };
        std::wstring format{ L"mp4" };
        std::wstring title;
        std::optional<std::wstring> cookiesFromBrowser{ L"auto" };
        std::optional<double> maxSizeMb;
        std::optional<double> startTimeSeconds;
        std::optional<double> endTimeSeconds;
        std::optional<std::filesystem::path> ytDlp;
        std::optional<std::filesystem::path> ffmpeg;
        std::optional<std::filesystem::path> ffprobe;
        bool overwrite{};
        bool lowResources{}; // FFmpeg at lowest priority with 2 threads (--low-resources)
    };

    struct ParseResult
    {
        std::optional<Options> options;
        std::wstring error;
    };

    struct EncodePlan
    {
        std::uint64_t targetBytes{};
        std::uint32_t audioKbps{};
        std::uint32_t videoKbps{};
    };

    ParseResult ParseArguments(std::vector<std::wstring> const& arguments);
    bool IsNativeHostLaunch(std::vector<std::wstring> const& arguments);
    // Manifeste Firefox de messagerie native (UTF-8) ; `exePath` est l'exécutable lui-même.
    std::string BuildNativeManifest(std::string_view exePath, std::string_view extensionId);
    // Emplacement du manifeste : Windows à côté de l'exécutable, sinon sous le dossier personnel.
    std::filesystem::path NativeManifestPath(HostPlatform platform, std::filesystem::path const& home, std::filesystem::path const& exeDirectory);
    // Résout `requested` en chemin absolu et crée le dossier et vérifie l'écriture (fichier témoin créé puis supprimé) ;
    // false si inutilisable (fichier, droits, lecture seule, chemin invalide). Ne lève jamais.
    bool EnsureOutputDirectory(std::filesystem::path const& requested, std::filesystem::path& resolved);
    bool IsSupportedUrl(std::wstring_view value);
    bool IsYouTubeUrl(std::wstring_view value);
    bool IsTwitterUrl(std::wstring_view value);
    std::wstring BuildFormatSelector(std::wstring const& quality);
    std::wstring BuildDownloadSection(double startTimeSeconds, double endTimeSeconds);
    std::wstring SanitizeFileName(std::wstring_view value);
    std::string SummarizeDownloadFailure(std::string_view output);
    // Durée en secondes lue sur la ligne "Duration: HH:MM:SS.xx" de `ffmpeg -i` ; nullopt si absente, "N/A" ou nulle.
    std::optional<double> ParseFfmpegDuration(std::string_view output);
    std::optional<EncodePlan> CalculateEncodePlan(double durationSeconds, double maxSizeMb);
    // FFmpeg arguments of one x264 pass (1 or 2). `lowResources` only adds "-threads 2"; priority is the caller's concern.
    std::vector<std::wstring> BuildEncodeArguments(
        std::filesystem::path const& source, std::filesystem::path const& destination, std::filesystem::path const& passLog,
        std::uint32_t videoKbps, std::uint32_t audioKbps, std::wstring const& quality, int pass, bool lowResources);

    // One yt-dlp line produced by the --progress-template the engine passes (see docs/CLI_PROTOCOL.md).
    struct DownloadProgressLine
    {
        std::string status; // downloading | finished | error
        std::optional<double> downloadedBytes, totalBytes, fragmentIndex, fragmentCount;
        std::string formatId;
    };
    std::optional<DownloadProgressLine> ParseDownloadProgressLine(std::string_view line);
    // "__MD_POST__:started|Merger" -> "Merger"; any other line (including "finished") -> nullopt.
    std::optional<std::string> ParsePostprocessorStart(std::string_view line);

    // Turns per-stream yt-dlp progress into one monotonic 0-100 download percent: the first stream (video) covers
    // 0-85, the following ones (audio) 85-100. shortcut: stream sizes are unknown up front, so a single-file
    // download stops at 85 until the real end; refine if yt-dlp exposes the requested formats in the template.
    class DownloadProgressSmoother
    {
    public:
        std::optional<double> Update(DownloadProgressLine const& line);
    private:
        std::string formatId_;
        bool started_{};
        int stream_{};
        double last_{};
    };
    std::string JsonEscape(std::string_view value);
    std::string WideToUtf8(std::wstring_view value);
    std::wstring Utf8ToWide(std::string_view value);
}
