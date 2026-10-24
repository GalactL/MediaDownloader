// POSIX only (registered in CMake under if(NOT WIN32)).
#include "ChildProcess.h"

#include <cerrno>
#include <chrono>
#include <csignal>
#include <cstdio>
#include <fstream>
#include <iostream>
#include <string>
#include <sys/types.h>
#include <unistd.h>
#include <vector>

using namespace media_downloader;

namespace
{
    int failures = 0;

    void Check(bool condition, char const* message)
    {
        if (!condition)
        {
            std::cerr << "FAIL: " << message << "\n";
            ++failures;
        }
    }

    // A zombie (killed but not yet reaped by init) counts as gone.
    bool IsGone(pid_t pid)
    {
        if (kill(pid, 0) != 0 && errno == ESRCH) return true;
        std::ifstream stat("/proc/" + std::to_string(pid) + "/stat");
        std::string content;
        std::getline(stat, content);
        auto close = content.rfind(')');
        return close != std::string::npos && close + 2 < content.size() && content[close + 2] == 'Z';
    }

    ProcessResult RunShell(std::string const& script, LineCallback const& onLine, std::atomic_bool const& cancel)
    {
        return RunProcess("/bin/sh", { L"-c", std::wstring(script.begin(), script.end()) }, {}, onLine, cancel);
    }
}

int main()
{
    std::atomic_bool never{ false };

    {
        std::vector<std::string> lines;
        auto result = RunShell("echo one; echo two >&2; printf partial; exit 7",
            [&](std::string const& line) { lines.push_back(line); }, never);
        Check(result.exitCode == 7, "exit code is returned");
        Check(!result.cancelled, "normal run is not cancelled");
        Check(lines == std::vector<std::string>({ "one", "two", "partial" }), "stdout+stderr lines are streamed");
    }

    {
        auto result = RunProcess("/bin/sh", { L"-c", L"pwd" }, "/", nullptr, never);
        Check(result.output == "/\n", "working directory is applied");
        Check(RunProcess("/bin/sh", { L"-c", L"true" }, "/nonexistent-dir", nullptr, never).exitCode == 127,
            "failed chdir does not run the program");
    }

    {
        // The shell ignores SIGTERM and so does its grandchild (ignored signals survive exec): only SIGKILL works.
        auto pidFile = std::string("/tmp/mediadownloader-process-test-") + std::to_string(getpid());
        std::atomic_bool cancel{ false };
        auto begin = std::chrono::steady_clock::now();
        auto result = RunShell("trap '' TERM; sleep 300 & echo $! > " + pidFile + "; echo ready; wait",
            [&](std::string const& line) { if (line == "ready") cancel = true; }, cancel);
        auto elapsed = std::chrono::steady_clock::now() - begin;

        Check(result.cancelled, "cancel is reported");
        Check(elapsed < std::chrono::seconds(8), "cancel completes after the grace period, not forever");

        pid_t grandchild = 0;
        std::ifstream(pidFile) >> grandchild;
        std::remove(pidFile.c_str());
        Check(grandchild > 0, "grandchild pid was recorded");
        Check(grandchild > 0 && IsGone(grandchild), "grandchild is gone after cancel");
    }

    if (failures == 0) std::cout << "All process tests passed\n";
    return failures == 0 ? 0 : 1;
}
