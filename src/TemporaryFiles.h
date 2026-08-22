#pragma once

#include <cstdint>
#include <filesystem>
#include <functional>
#include <string>
#include <string_view>
#include <vector>

namespace media_downloader
{
    struct TemporaryCleanupResult
    {
        std::vector<std::filesystem::path> removed;
        std::vector<std::pair<std::filesystem::path, std::string>> failures;
    };

    bool TryParseTemporaryDirectoryName(std::wstring_view name, std::uint64_t& processId);
    bool IsProcessRunning(std::uint64_t processId);
    TemporaryCleanupResult CleanupOrphanedTemporaryDirectories(
        std::filesystem::path const& outputDirectory,
        std::function<bool(std::uint64_t)> const& isProcessRunning = IsProcessRunning);
}
