#include "ChildProcess.h"
#include "Core.h"

#include <array>
#include <cerrno>
#include <chrono>
#include <csignal>
#include <fcntl.h>
#include <stdexcept>
#include <sys/types.h>
#include <sys/wait.h>
#include <thread>
#include <unistd.h>

namespace media_downloader
{
    namespace
    {
        constexpr auto kTerminateGracePeriod = std::chrono::seconds(3);
        constexpr auto kPollInterval = std::chrono::milliseconds(20);
    }

    ProcessResult RunProcess(
        std::filesystem::path const& executable,
        std::vector<std::wstring> const& arguments,
        std::filesystem::path const& workingDirectory,
        LineCallback const& onLine,
        std::atomic_bool const& cancellationRequested)
    {
        // Everything the child needs is built before fork(): after it, only async-signal-safe calls are allowed.
        std::string const program = executable.string();
        std::string const directory = workingDirectory.string();
        std::vector<std::string> utf8Arguments{ program };
        for (auto const& argument : arguments) utf8Arguments.push_back(WideToUtf8(argument));
        std::vector<char*> rawArguments;
        for (auto& argument : utf8Arguments) rawArguments.push_back(argument.data());
        rawArguments.push_back(nullptr);

        int descriptors[2]{};
        if (pipe(descriptors) != 0) throw std::runtime_error("Impossible de créer le canal du processus externe");

        // Children must not share our stdin: in host mode it carries the framed protocol.
        int const nullInput = open("/dev/null", O_RDONLY | O_CLOEXEC);

        auto child = fork();
        if (child < 0)
        {
            if (nullInput >= 0) close(nullInput);
            close(descriptors[0]); close(descriptors[1]);
            throw std::runtime_error("Impossible de lancer le processus externe");
        }
        if (child == 0)
        {
            setpgid(0, 0);
            close(descriptors[0]);
            if (nullInput >= 0) dup2(nullInput, STDIN_FILENO);
            dup2(descriptors[1], STDOUT_FILENO);
            dup2(descriptors[1], STDERR_FILENO);
            close(descriptors[1]);
            if (!directory.empty() && chdir(directory.c_str()) != 0) _exit(127);
            execv(program.c_str(), rawArguments.data());
            _exit(127);
        }

        setpgid(child, child); // the child does it too: whichever runs first wins, so kill(-child) is never early
        close(descriptors[1]);
        if (nullInput >= 0) close(nullInput);
        std::string output;
        std::string pending;
        std::atomic_bool readerDone{ false };
        std::thread reader([&]
        {
            std::array<char, 4096> buffer{};
            ssize_t count{};
            while ((count = read(descriptors[0], buffer.data(), buffer.size())) != 0)
            {
                if (count < 0)
                {
                    if (errno == EINTR) continue;
                    break;
                }
                output.append(buffer.data(), static_cast<size_t>(count));
                pending.append(buffer.data(), static_cast<size_t>(count));
                size_t newline{};
                while ((newline = pending.find('\n')) != std::string::npos)
                {
                    auto line = pending.substr(0, newline);
                    if (!line.empty() && line.back() == '\r') line.pop_back();
                    pending.erase(0, newline + 1);
                    if (onLine) onLine(line);
                }
            }
            if (!pending.empty() && onLine) onLine(pending);
            close(descriptors[0]);
            readerDone = true;
        });

        // The leader exiting is not enough: grandchildren can outlive it and keep the pipe open.
        // On cancellation: SIGTERM to the whole group, grace period, then SIGKILL to the group.
        int status{};
        bool reaped{};
        bool cancelled{};
        bool killed{};
        std::chrono::steady_clock::time_point deadline;
        for (;;)
        {
            if (!reaped)
            {
                auto result = waitpid(child, &status, WNOHANG);
                if (result == child || (result < 0 && errno != EINTR)) reaped = true;
            }
            // Once the leader is reaped, ESRCH means the group is empty (its id cannot be recycled while a member lives).
            bool const groupAlive = !reaped || kill(-child, 0) == 0 || errno != ESRCH;
            if (reaped && readerDone && !(cancelled && groupAlive)) break;

            if (!cancelled && cancellationRequested)
            {
                cancelled = true;
                kill(-child, SIGTERM);
                deadline = std::chrono::steady_clock::now() + kTerminateGracePeriod;
            }
            if (cancelled && !killed && groupAlive && std::chrono::steady_clock::now() >= deadline)
            {
                killed = true;
                kill(-child, SIGKILL);
            }
            std::this_thread::sleep_for(kPollInterval);
        }
        reader.join();
        unsigned long exitCode = WIFEXITED(status) ? static_cast<unsigned long>(WEXITSTATUS(status)) : 128ul;
        return { exitCode, std::move(output), cancelled };
    }
}
