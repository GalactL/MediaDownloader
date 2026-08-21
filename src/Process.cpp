#include "ChildProcess.h"

#include <process.h>
#include <windows.h>

#include <array>
#include <stdexcept>
#include <thread>

namespace media_downloader
{
    namespace
    {
        std::wstring QuoteArgument(std::wstring const& argument)
        {
            if (argument.empty()) return L"\"\"";
            if (argument.find_first_of(L" \t\n\v\"") == std::wstring::npos) return argument;

            std::wstring quoted{ L'"' };
            size_t backslashes{};
            for (wchar_t character : argument)
            {
                if (character == L'\\')
                {
                    ++backslashes;
                    continue;
                }
                if (character == L'"')
                {
                    quoted.append(backslashes * 2 + 1, L'\\');
                    quoted.push_back(L'"');
                    backslashes = 0;
                    continue;
                }
                quoted.append(backslashes, L'\\');
                backslashes = 0;
                quoted.push_back(character);
            }
            quoted.append(backslashes * 2, L'\\');
            quoted.push_back(L'"');
            return quoted;
        }

        struct Handle
        {
            HANDLE value{ INVALID_HANDLE_VALUE };
            ~Handle() { if (value != INVALID_HANDLE_VALUE && value != nullptr) CloseHandle(value); }
            Handle() = default;
            explicit Handle(HANDLE handle) : value(handle) {}
            Handle(Handle const&) = delete;
            Handle& operator=(Handle const&) = delete;
            Handle(Handle&& other) noexcept : value(other.value) { other.value = INVALID_HANDLE_VALUE; }
            Handle& operator=(Handle&& other) noexcept
            {
                if (this != &other)
                {
                    if (value != INVALID_HANDLE_VALUE && value != nullptr) CloseHandle(value);
                    value = other.value;
                    other.value = INVALID_HANDLE_VALUE;
                }
                return *this;
            }
        };
    }

    ProcessResult RunProcess(
        std::filesystem::path const& executable,
        std::vector<std::wstring> const& arguments,
        std::filesystem::path const& workingDirectory,
        LineCallback const& onLine,
        std::atomic_bool const& cancellationRequested)
    {
        SECURITY_ATTRIBUTES attributes{ sizeof(SECURITY_ATTRIBUTES), nullptr, TRUE };
        HANDLE rawRead{};
        HANDLE rawWrite{};
        if (!CreatePipe(&rawRead, &rawWrite, &attributes, 0)) throw std::runtime_error("CreatePipe a échoué");
        Handle readPipe(rawRead);
        Handle writePipe(rawWrite);
        SetHandleInformation(readPipe.value, HANDLE_FLAG_INHERIT, 0);

        std::wstring commandLine = QuoteArgument(executable.wstring());
        for (auto const& argument : arguments)
        {
            commandLine.push_back(L' ');
            commandLine += QuoteArgument(argument);
        }
        std::vector<wchar_t> mutableCommand(commandLine.begin(), commandLine.end());
        mutableCommand.push_back(L'\0');

        STARTUPINFOW startup{};
        startup.cb = sizeof(startup);
        startup.dwFlags = STARTF_USESTDHANDLES;
        startup.hStdOutput = writePipe.value;
        startup.hStdError = writePipe.value;
        startup.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
        PROCESS_INFORMATION process{};
        auto directory = workingDirectory.empty() ? std::wstring{} : workingDirectory.wstring();

        if (!CreateProcessW(executable.c_str(), mutableCommand.data(), nullptr, nullptr, TRUE,
            CREATE_NO_WINDOW, nullptr, directory.empty() ? nullptr : directory.c_str(), &startup, &process))
        {
            throw std::runtime_error("Impossible de lancer le processus externe");
        }
        Handle processHandle(process.hProcess);
        Handle threadHandle(process.hThread);
        writePipe = Handle();

        std::string output;
        std::string pending;
        std::atomic_bool reading{ true };
        std::thread reader([&]
        {
            std::array<char, 4096> buffer{};
            DWORD read{};
            while (ReadFile(readPipe.value, buffer.data(), static_cast<DWORD>(buffer.size()), &read, nullptr) && read > 0)
            {
                output.append(buffer.data(), read);
                pending.append(buffer.data(), read);
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
            reading = false;
        });

        bool cancelled{};
        while (WaitForSingleObject(processHandle.value, 100) == WAIT_TIMEOUT)
        {
            if (cancellationRequested)
            {
                cancelled = true;
                TerminateProcess(processHandle.value, ERROR_CANCELLED);
                break;
            }
        }
        WaitForSingleObject(processHandle.value, INFINITE);
        DWORD exitCode{};
        GetExitCodeProcess(processHandle.value, &exitCode);
        if (reader.joinable()) reader.join();
        return { exitCode, std::move(output), cancelled };
    }
}
