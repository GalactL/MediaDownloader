#include "TemporaryFiles.h"

#include <charconv>
#include <limits>
#include <system_error>

#ifdef _WIN32
#include <windows.h>
#else
#include <cerrno>
#include <csignal>
#endif

namespace media_downloader
{
    bool TryParseTemporaryDirectoryName(std::wstring_view name, std::uint64_t& processId)
    {
        constexpr std::wstring_view prefix = L".mediadownloader-";
        if (!name.starts_with(prefix)) return false;
        auto suffix = name.substr(prefix.size());
        auto separator = suffix.find(L'-');
        if (separator == std::wstring_view::npos || separator == 0 || separator + 1 >= suffix.size()) return false;

        auto pidText = suffix.substr(0, separator);
        auto timestampText = suffix.substr(separator + 1);
        auto digitsOnly = [](std::wstring_view value)
        {
            for (auto character : value) if (character < L'0' || character > L'9') return false;
            return !value.empty();
        };
        if (!digitsOnly(pidText) || !digitsOnly(timestampText)) return false;

        try
        {
            processId = std::stoull(std::wstring(pidText));
            return processId > 0;
        }
        catch (...) { return false; }
    }

    bool IsProcessRunning(std::uint64_t processId)
    {
        if (processId == 0) return false;
#ifdef _WIN32
        if (processId > std::numeric_limits<DWORD>::max()) return false;
        auto process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, static_cast<DWORD>(processId));
        if (!process) return GetLastError() == ERROR_ACCESS_DENIED;
        DWORD exitCode{};
        auto running = GetExitCodeProcess(process, &exitCode) && exitCode == STILL_ACTIVE;
        CloseHandle(process);
        return running;
#else
        if (processId > static_cast<std::uint64_t>(std::numeric_limits<pid_t>::max())) return false;
        if (kill(static_cast<pid_t>(processId), 0) == 0) return true;
        return errno == EPERM;
#endif
    }

    TemporaryCleanupResult CleanupOrphanedTemporaryDirectories(
        std::filesystem::path const& outputDirectory,
        std::function<bool(std::uint64_t)> const& isProcessRunning)
    {
        TemporaryCleanupResult result;
        std::error_code iteratorError;
        for (auto const& entry : std::filesystem::directory_iterator(outputDirectory, iteratorError))
        {
            if (iteratorError) break;
            std::error_code typeError;
            if (!entry.is_directory(typeError) || typeError) continue;
            std::uint64_t processId{};
            if (!TryParseTemporaryDirectoryName(entry.path().filename().wstring(), processId)) continue;
            if (isProcessRunning(processId)) continue;

            std::error_code removeError;
            std::filesystem::remove_all(entry.path(), removeError);
            if (removeError) result.failures.emplace_back(entry.path(), removeError.message());
            else result.removed.push_back(entry.path());
        }
        if (iteratorError) result.failures.emplace_back(outputDirectory, iteratorError.message());
        return result;
    }
}
