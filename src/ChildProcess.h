#pragma once

#include <atomic>
#include <filesystem>
#include <functional>
#include <string>
#include <vector>

namespace media_downloader
{
    struct ProcessResult
    {
        unsigned long exitCode{};
        std::string output;
        bool cancelled{};
    };

    using LineCallback = std::function<void(std::string const&)>;

    ProcessResult RunProcess(
        std::filesystem::path const& executable,
        std::vector<std::wstring> const& arguments,
        std::filesystem::path const& workingDirectory,
        LineCallback const& onLine,
        std::atomic_bool const& cancellationRequested);
}
