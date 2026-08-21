#include "ChildProcess.h"
#include "Core.h"

#include <array>
#include <cerrno>
#include <csignal>
#include <stdexcept>
#include <sys/types.h>
#include <sys/wait.h>
#include <thread>
#include <unistd.h>

namespace media_downloader
{
    ProcessResult RunProcess(
        std::filesystem::path const& executable,
        std::vector<std::wstring> const& arguments,
        std::filesystem::path const& workingDirectory,
        LineCallback const& onLine,
        std::atomic_bool const& cancellationRequested)
    {
        int descriptors[2]{};
        if (pipe(descriptors) != 0) throw std::runtime_error("Impossible de créer le canal du processus externe");

        auto child = fork();
        if (child < 0)
        {
            close(descriptors[0]); close(descriptors[1]);
            throw std::runtime_error("Impossible de lancer le processus externe");
        }
        if (child == 0)
        {
            setpgid(0, 0);
            close(descriptors[0]);
            dup2(descriptors[1], STDOUT_FILENO);
            dup2(descriptors[1], STDERR_FILENO);
            close(descriptors[1]);
            if (!workingDirectory.empty()) chdir(workingDirectory.c_str());

            std::vector<std::string> utf8Arguments{ executable.string() };
            for (auto const& argument : arguments) utf8Arguments.push_back(WideToUtf8(argument));
            std::vector<char*> rawArguments;
            for (auto& argument : utf8Arguments) rawArguments.push_back(argument.data());
            rawArguments.push_back(nullptr);
            execv(executable.c_str(), rawArguments.data());
            _exit(127);
        }

        close(descriptors[1]);
        std::string output;
        std::string pending;
        std::thread reader([&]
        {
            std::array<char, 4096> buffer{};
            ssize_t count{};
            while ((count = read(descriptors[0], buffer.data(), buffer.size())) > 0)
            {
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
        });

        int status{};
        bool cancelled{};
        while (waitpid(child, &status, WNOHANG) == 0)
        {
            if (cancellationRequested)
            {
                cancelled = true;
                kill(-child, SIGTERM);
                waitpid(child, &status, 0);
                break;
            }
            usleep(100000);
        }
        if (reader.joinable()) reader.join();
        unsigned long exitCode = WIFEXITED(status) ? static_cast<unsigned long>(WEXITSTATUS(status)) : 128ul;
        return { exitCode, std::move(output), cancelled };
    }
}
