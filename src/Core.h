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
        InstallHost
    };

    enum class HostPlatform { Windows, MacOS, Linux };

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
    bool IsSupportedUrl(std::wstring_view value);
    bool IsYouTubeUrl(std::wstring_view value);
    std::wstring BuildFormatSelector(std::wstring const& quality);
    std::wstring BuildDownloadSection(double startTimeSeconds, double endTimeSeconds);
    std::wstring SanitizeFileName(std::wstring_view value);
    std::string SummarizeDownloadFailure(std::string_view output);
    std::optional<EncodePlan> CalculateEncodePlan(double durationSeconds, double maxSizeMb);
    std::string JsonEscape(std::string_view value);
    std::string WideToUtf8(std::wstring_view value);
    std::wstring Utf8ToWide(std::string_view value);
}
