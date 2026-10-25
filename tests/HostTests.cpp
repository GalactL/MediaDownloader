// Tests the Firefox native messaging host: the JSON parser (everywhere) and the built CLI `host`
// command driven over pipes with the POSIX shell fake tools (never touches the network).
#include "Host.h"

#include <filesystem>
#include <iostream>
#include <optional>
#include <string>
#include <vector>

#ifndef _WIN32
#include <cerrno>
#include <chrono>
#include <csignal>
#include <cstdint>
#include <cstring>
#include <fcntl.h>
#include <fstream>
#include <poll.h>
#include <sys/wait.h>
#include <thread>
#include <unistd.h>
#endif

#ifndef MD_CLI_PATH
#define MD_CLI_PATH ""
#endif
#ifndef MD_FAKE_TOOLS_DIR
#define MD_FAKE_TOOLS_DIR ""
#endif

namespace fs = std::filesystem;
using namespace media_downloader;
static int g_failures = 0;

static void Check(bool condition, std::string const& message)
{
    if (!condition) { ++g_failures; std::cerr << "FAIL: " << message << '\n'; }
}

static void TestParser()
{
    auto ok = ParseJson(R"({"a":[1,2.5e1,-0,true,false,null],"s":"x\u00e9\ud83d\ude00\n\"\\\/","a":"dup"})");
    Check(ok && ok->type == Json::Type::Object, "parser: object");
    if (ok)
    {
        Check(ok->Get("a") && ok->Get("a")->string == "dup", "parser: last duplicate key wins");
        Check(ok->Get("s") && ok->Get("s")->string == "x\xC3\xA9\xF0\x9F\x98\x80\n\"\\/", "parser: escapes and surrogate pair");
        Check(!ok->Get("missing"), "parser: missing key");
    }
    auto arr = ParseJson(" [1, 2.5e1, -0, true, false, null, {}, []] ");
    Check(arr && arr->array.size() == 8 && arr->array[1].number == 25.0 && arr->array[3].boolean &&
        !arr->array[4].boolean && arr->array[5].type == Json::Type::Null && arr->array[6].type == Json::Type::Object,
        "parser: array of scalars");
    for (auto const* bad : { "", "{", "[1,]", "{\"a\":1,}", "01", "1.", "-", "1e", "\"\\ud800\"", "\"\\udc00\"", "\"\\ud83dx\"",
        "\"a\nb\"", "tru", "{} x", "'a'", "{\"a\" 1}", "\"\\x\"", "\"\\u12G4\"", "[1 2]", "{1:2}" })
        Check(!ParseJson(bad), std::string("parser rejects: ") + bad);
    for (auto const* bad : { "\"\xff\"", "\"\xc0\x80\"", "\"\xed\xa0\x80\"", "\"\xf4\x90\x80\x80\"", "\"\xe2\x82\"", "\"\xe2\x82(\"", "\"\x80\"" })
        Check(!ParseJson(bad), "parser rejects invalid UTF-8");
    Check(ParseJson("\"\xe2\x82\xac \xf0\x9f\x98\x80 \xc3\xa9\"").has_value(), "parser accepts valid UTF-8");
    Check(!ParseJson(std::string(100, '[') + std::string(100, ']')), "parser: depth limit");
    Check(ParseJson(std::string(30, '[') + std::string(30, ']')).has_value(), "parser: moderate depth ok");
}

#ifdef _WIN32
int main()
{
    TestParser();
    std::cout << "HostTests: process tests skipped (POSIX shell fake tools required)\n";
    return g_failures == 0 ? 0 : 1;
}
#else

namespace
{
    using Clock = std::chrono::steady_clock;

    fs::path g_tmp;
    int g_counter{};

    fs::path NewDir(std::string const& name)
    {
        auto dir = g_tmp / (name + std::to_string(++g_counter));
        fs::create_directories(dir);
        return dir;
    }

    // Cleanup can finish just after the terminal event: poll up to 2 s instead of checking once.
    template <typename Pred>
    bool Eventually(Pred pred)
    {
        for (int i = 0; i < 200; ++i)
        {
            if (pred()) return true;
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
        }
        return pred();
    }

    bool NoTempDirs(fs::path const& dir)
    {
        return Eventually([&]
        {
            for (auto const& e : fs::directory_iterator(dir))
                if (e.path().filename().string().starts_with(".mediadownloader-")) return false;
            return true;
        });
    }

    bool DirEmpty(fs::path const& dir) { return Eventually([&] { return fs::is_empty(dir); }); }

    bool Contains(std::string const& s, std::string const& needle) { return s.find(needle) != std::string::npos; }

    bool Gone(pid_t pid) { return Eventually([&] { return kill(pid, 0) == -1 && errno == ESRCH; }); }

    // Reads the pid a hanging fake tool wrote, waiting for the file to appear.
    pid_t WaitPid(fs::path const& file)
    {
        for (int i = 0; i < 500; ++i)
        {
            std::ifstream in(file);
            long pid{};
            if (in >> pid && pid > 0) return static_cast<pid_t>(pid);
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
        }
        return -1;
    }

    struct HostProcess
    {
        pid_t pid{ -1 };
        int in{ -1 }, out{ -1 };

        explicit HostProcess(std::vector<std::string> const& extraEnv = {})
        {
            int toChild[2], fromChild[2];
            if (pipe(toChild) != 0 || pipe(fromChild) != 0) return;
            fs::path tools = MD_FAKE_TOOLS_DIR;
            std::vector<std::string> env{ "HOME=" + (g_tmp / "home").string(), "PATH=/usr/bin:/bin",
                "MEDIADOWNLOADER_YTDLP=" + (tools / "yt-dlp").string(), "MEDIADOWNLOADER_FFMPEG=" + (tools / "ffmpeg").string(),
                "MEDIADOWNLOADER_FFPROBE=" + (tools / "ffprobe").string(), "MEDIADOWNLOADER_DENO=" + (tools / "deno").string() };
            env.insert(env.end(), extraEnv.begin(), extraEnv.end());
            std::vector<char*> envp;
            for (auto& e : env) envp.push_back(e.data());
            envp.push_back(nullptr);
            std::string cli = MD_CLI_PATH, host = "host", manifest = "/some/manifest.json", extension = "md@example.org";
            char* argv[] = { cli.data(), host.data(), manifest.data(), extension.data(), nullptr }; // Firefox-style extra argv

            pid = fork();
            if (pid == 0)
            {
                dup2(toChild[0], 0);
                dup2(fromChild[1], 1);
                int devnull = open("/dev/null", O_WRONLY);
                if (devnull >= 0) dup2(devnull, 2);
                for (int fd : { toChild[0], toChild[1], fromChild[0], fromChild[1] }) close(fd);
                if (chdir(g_tmp.c_str()) != 0) _exit(126);
                execve(cli.c_str(), argv, envp.data());
                _exit(127);
            }
            close(toChild[0]);
            close(fromChild[1]);
            in = toChild[1];
            out = fromChild[0];
        }

        ~HostProcess()
        {
            CloseInput();
            if (out >= 0) close(out);
            if (pid > 0) { kill(pid, SIGKILL); waitpid(pid, nullptr, 0); }
        }

        void CloseInput() { if (in >= 0) { close(in); in = -1; } }

        void SendRaw(void const* data, size_t size)
        {
            auto const* p = static_cast<char const*>(data);
            while (size > 0)
            {
                auto n = write(in, p, size);
                if (n <= 0) return;
                p += n; size -= static_cast<size_t>(n);
            }
        }

        void Send(std::string const& json)
        {
            std::uint32_t length = static_cast<std::uint32_t>(json.size());
            SendRaw(&length, sizeof length);
            SendRaw(json.data(), json.size());
        }

        bool ReadExact(void* data, size_t size, Clock::time_point deadline)
        {
            auto* p = static_cast<char*>(data);
            while (size > 0)
            {
                auto left = std::chrono::duration_cast<std::chrono::milliseconds>(deadline - Clock::now()).count();
                if (left <= 0) return false;
                pollfd fd{ out, POLLIN, 0 };
                if (poll(&fd, 1, static_cast<int>(left)) <= 0) return false;
                auto n = read(out, p, size);
                if (n <= 0) return false;
                p += n; size -= static_cast<size_t>(n);
            }
            return true;
        }

        std::optional<std::string> Recv(int timeoutMs = 10000)
        {
            auto deadline = Clock::now() + std::chrono::milliseconds(timeoutMs);
            std::uint32_t length{};
            if (!ReadExact(&length, sizeof length, deadline) || length > (1u << 20)) return std::nullopt;
            std::string body(length, '\0');
            if (!ReadExact(body.data(), length, deadline)) return std::nullopt;
            return body;
        }

        // Receives messages up to and including the first terminal one.
        std::vector<std::string> RecvJob()
        {
            std::vector<std::string> messages;
            while (auto message = Recv())
            {
                messages.push_back(*message);
                for (auto const* type : { "completed", "error", "probe", "doctor" })
                    if (message->starts_with(std::string("{\"type\":\"") + type + "\"")) return messages;
            }
            messages.push_back("<timeout or eof>");
            return messages;
        }

        // Closes stdin and returns the host's exit code (-1 if it did not exit in time).
        int Finish(bool closeInput = true)
        {
            if (closeInput) CloseInput();
            for (int i = 0; i < 500; ++i)
            {
                int status{};
                if (waitpid(pid, &status, WNOHANG) == pid)
                {
                    pid = -1;
                    return WIFEXITED(status) ? WEXITSTATUS(status) : -2;
                }
                std::this_thread::sleep_for(std::chrono::milliseconds(10));
            }
            return -1;
        }
    };

    std::string Last(std::vector<std::string> const& messages) { return messages.back(); }

    void TestProbe()
    {
        HostProcess host({ "FAKE_YTDLP_PROBE_JSON={\"id\":\"abc\",\"title\":\"Titre \\u00e9t\\u00e9\",\"duration\":12.5,\"uploader\":\"U\","
            "\"thumbnail\":\"https://t/x.jpg\",\"webpage_url\":\"https://example.com/v\",\"description\":\"big\","
            "\"formats\":[{\"height\":1080},{\"height\":720},{\"height\":null},{\"height\":720},{},{\"height\":360.0}]}" });
        host.Send(R"({"type":"probe","id":"p1","url":"https://example.com/v"})");
        auto messages = host.RecvJob();
        Check(messages.size() == 1, "probe: single message");
        Check(Last(messages) == "{\"type\":\"probe\",\"id\":\"p1\",\"data\":{\"id\":\"abc\",\"title\":\"Titre \xC3\xA9t\xC3\xA9\","
            "\"duration\":12.5,\"uploader\":\"U\",\"thumbnail\":\"https://t/x.jpg\",\"webpage_url\":\"https://example.com/v\","
            "\"heights\":[360,720,1080]}}", "probe: compact data, got " + Last(messages));
        Check(host.Finish() == 0, "probe: EOF exits 0");
    }

    void TestDownloadAndDoctor()
    {
        auto out = NewDir("out");
        HostProcess host;
        host.Send("{\"type\":\"download\",\"id\":\"d1\",\"url\":\"https://example.com/v\",\"quality\":\"720\",\"format\":\"mp4\","
            "\"title\":\"Mon titre\",\"maxSizeMb\":10,\"overwrite\":false,\"outputDirectory\":\"" + out.string() + "\"}");
        auto messages = host.RecvJob();
        Check(messages.size() >= 3, "download: several messages");
        bool progress = false;
        for (auto const& m : messages)
        {
            Check(m.starts_with("{\"type\":\"") && Contains(m, ",\"id\":\"d1\""), "download: id echoed: " + m);
            progress |= m.starts_with("{\"type\":\"progress\",\"id\":\"d1\"");
        }
        Check(progress, "download: progress streamed");
        Check(messages.front().starts_with("{\"type\":\"started\",\"id\":\"d1\""), "download: started first: " + messages.front());
        Check(Last(messages).starts_with("{\"type\":\"completed\",\"id\":\"d1\",\"path\":\""), "download: completed last: " + Last(messages));
        Check(NoTempDirs(out), "download: no temp dir left");

        // The host stays alive for the next request, and doctor needs no id.
        host.Send(R"({"type":"doctor"})");
        auto doctor = host.RecvJob();
        Check(doctor.size() == 1 && doctor[0].starts_with("{\"type\":\"doctor\",\"tools\":{"), "doctor after job");
        Check(host.Finish() == 0, "download: EOF exits 0");
    }

    void TestDownloadFailure()
    {
        auto out = NewDir("out");
        HostProcess host({ "FAKE_YTDLP_MODE=fail" });
        host.Send("{\"type\":\"download\",\"id\":\"f1\",\"url\":\"https://example.com/v\",\"outputDirectory\":\"" + out.string() + "\"}");
        auto messages = host.RecvJob();
        Check(Last(messages).starts_with("{\"type\":\"error\",\"id\":\"f1\",\"code\":\"download_failed\""), "failure: download_failed: " + Last(messages));
        Check(NoTempDirs(out), "failure: no temp dir left");
        host.Send(R"({"type":"probe","id":"f2","url":"https://example.com/v"})");
        Check(Last(host.RecvJob()).starts_with("{\"type\":\"error\",\"id\":\"f2\""), "failure: host still serves requests");
        Check(host.Finish() == 0, "failure: EOF exits 0");
    }

    void TestInvalidMessages()
    {
        HostProcess host;
        struct Case { std::string request; std::string expected; };
        std::vector<Case> cases{
            { R"({"type":"download","id":"i1","url":"https://example.com/v","startTime":5})", "{\"type\":\"error\",\"id\":\"i1\",\"code\":\"invalid_arguments\"" },
            { R"({"type":"download","id":"i2","url":"https://example.com/v","startTime":10,"endTime":5})", "{\"type\":\"error\",\"id\":\"i2\",\"code\":\"invalid_arguments\"" },
            { R"({"type":"download","id":"i3","url":"ftp://example.com/v"})", "{\"type\":\"error\",\"id\":\"i3\",\"code\":\"invalid_arguments\"" },
            { R"({"type":"download","id":"i4"})", "{\"type\":\"error\",\"id\":\"i4\",\"code\":\"invalid_arguments\"" },
            { R"({"type":"download","id":"i5","url":"https://example.com/v","maxSizeMb":"10"})", "{\"type\":\"error\",\"id\":\"i5\",\"code\":\"invalid_arguments\"" },
            { R"({"type":"probe","id":"i6","url":"https://example.com/v","cookiesFromBrowser":"netscape"})", "{\"type\":\"error\",\"id\":\"i6\",\"code\":\"invalid_arguments\"" },
            { R"({"type":"bogus","id":"i7"})", "{\"type\":\"error\",\"id\":\"i7\",\"code\":\"invalid_message\"" },
            { R"({"id":"i8"})", "{\"type\":\"error\",\"code\":\"invalid_message\"" },
            { R"({"type":"download",)", "{\"type\":\"error\",\"code\":\"invalid_message\"" },
            { R"([1,2])", "{\"type\":\"error\",\"code\":\"invalid_message\"" },
            { "", "{\"type\":\"error\",\"code\":\"invalid_message\"" },
            // Invalid UTF-8 anywhere in a string: the whole message is invalid and no id is echoed.
            { "{\"type\":\"doctor\",\"id\":\"b\xff\"}", "{\"type\":\"error\",\"code\":\"invalid_message\"" },
            { "{\"type\":\"probe\",\"id\":\"u1\",\"url\":\"https://example.com/\xc3(\"}", "{\"type\":\"error\",\"code\":\"invalid_message\"" },
            { "{\"type\":\"download\",\"id\":\"t1\",\"url\":\"https://example.com/v\",\"title\":\"a\xed\xa0\x80z\"}", "{\"type\":\"error\",\"code\":\"invalid_message\"" },
        };
        for (auto const& c : cases)
        {
            host.Send(c.request);
            auto reply = host.Recv();
            Check(reply && reply->starts_with(c.expected), "invalid: " + c.request + " -> " + reply.value_or("<none>"));
        }
        host.Send(R"({"type":"cancel"})"); // no job: ignored silently
        host.Send(R"({"type":"doctor","id":"after"})");
        auto reply = host.Recv();
        Check(reply && reply->starts_with("{\"type\":\"doctor\",\"id\":\"after\""), "invalid: cancel without job is silent, host alive: " + reply.value_or("<none>"));

        // Oversized request: rejected, payload skipped, protocol stays in sync.
        std::uint32_t big = 5u * 1024 * 1024;
        host.SendRaw(&big, sizeof big);
        std::string filler(big, 'x');
        std::thread writer([&] { host.SendRaw(filler.data(), filler.size()); });
        auto tooLarge = host.Recv();
        writer.join();
        Check(tooLarge && tooLarge->starts_with("{\"type\":\"error\",\"code\":\"message_too_large\""), "oversized request rejected: " + tooLarge.value_or("<none>"));
        host.Send(R"({"type":"doctor","id":"sync"})");
        reply = host.Recv();
        Check(reply && reply->starts_with("{\"type\":\"doctor\",\"id\":\"sync\""), "oversized request: still in sync");
        Check(host.Finish() == 0, "invalid: EOF exits 0");
    }

    void TestBusyAndCancelYtDlp()
    {
        auto out = NewDir("out");
        auto pidFile = g_tmp / "ytdlp.pid";
        HostProcess host({ "FAKE_YTDLP_MODE=hang", "FAKE_YTDLP_PID_FILE=" + pidFile.string() });
        host.Send("{\"type\":\"download\",\"id\":\"h1\",\"url\":\"https://example.com/v\",\"outputDirectory\":\"" + out.string() + "\"}");
        auto tool = WaitPid(pidFile);
        Check(tool > 0, "cancel: fake yt-dlp started");

        host.Send(R"({"type":"download","id":"h2","url":"https://example.com/v"})");
        host.Send(R"({"type":"probe","id":"h3","url":"https://example.com/v"})");
        host.Send(R"({"type":"pickFolder","id":"h4"})");
        // Skip the started/log events of the running job; busy answers carry the new request ids.
        int busy = 0;
        while (busy < 3)
        {
            auto m = host.Recv();
            if (!m) { Check(false, "busy: missing busy answers"); break; }
            if (Contains(*m, "\"code\":\"busy\"")) { ++busy; Check(Contains(*m, "\"id\":\"h2\"") || Contains(*m, "\"id\":\"h3\"") || Contains(*m, "\"id\":\"h4\""), "busy: id echoed (pickFolder included)"); }
            else Check(Contains(*m, "\"id\":\"h1\""), "busy: other messages belong to h1: " + *m);
        }

        host.Send(R"({"type":"cancel"})");
        auto messages = host.RecvJob();
        Check(Last(messages).starts_with("{\"type\":\"error\",\"id\":\"h1\",\"code\":\"cancelled\""), "cancel: cancelled error: " + Last(messages));
        Check(tool > 0 && Gone(tool), "cancel: yt-dlp process is gone");
        Check(NoTempDirs(out), "cancel: temp dir removed");

        // Host is reusable after a cancellation.
        host.Send(R"({"type":"doctor","id":"again"})");
        auto reply = host.Recv();
        Check(reply && reply->starts_with("{\"type\":\"doctor\",\"id\":\"again\""), "cancel: host alive afterwards");
        Check(host.Finish() == 0, "cancel: EOF exits 0");
    }

#ifdef __linux__
    // HostProcess passes an explicit env (no DISPLAY/WAYLAND_DISPLAY, whatever the parent has): every chooser fails (or is absent), which must be a framed error, not a hang.
    void TestPickFolderWithoutDisplay()
    {
        HostProcess host;
        host.Send(R"({"type":"pickFolder","id":"p1"})");
        auto reply = host.Recv();
        Check(reply && reply->starts_with("{\"type\":\"error\",\"id\":\"p1\",\"code\":\"pick_failed\""), "pickFolder: pick_failed without display: " + reply.value_or("<none>"));
        host.Send(R"({"type":"doctor","id":"after"})");
        reply = host.Recv();
        Check(reply && reply->starts_with("{\"type\":\"doctor\",\"id\":\"after\""), "pickFolder: host alive afterwards");
        Check(host.Finish() == 0, "pickFolder: EOF exits 0");
    }
#endif

    void TestCancelFfmpeg()
    {
        auto out = NewDir("out");
        auto pidFile = g_tmp / "ffmpeg.pid";
        HostProcess host({ "FAKE_FFMPEG_MODE=hang", "FAKE_FFMPEG_PID_FILE=" + pidFile.string(), "FAKE_SOURCE_BYTES=3000000" });
        host.Send("{\"type\":\"download\",\"id\":\"e1\",\"url\":\"https://example.com/v\",\"maxSizeMb\":1,\"outputDirectory\":\"" + out.string() + "\"}");
        auto tool = WaitPid(pidFile);
        Check(tool > 0, "cancel ffmpeg: fake ffmpeg started");
        host.Send(R"({"type":"cancel"})");
        auto messages = host.RecvJob();
        Check(Last(messages).starts_with("{\"type\":\"error\",\"id\":\"e1\",\"code\":\"cancelled\""), "cancel ffmpeg: cancelled error: " + Last(messages));
        Check(tool > 0 && Gone(tool), "cancel ffmpeg: ffmpeg process is gone");
        Check(NoTempDirs(out), "cancel ffmpeg: temp dir removed");
        Check(DirEmpty(out), "cancel ffmpeg: no output file left");
        Check(host.Finish() == 0, "cancel ffmpeg: EOF exits 0");
    }

    void TestEofCancelsJob()
    {
        auto out = NewDir("out");
        auto pidFile = g_tmp / "eof.pid";
        HostProcess host({ "FAKE_YTDLP_MODE=hang", "FAKE_YTDLP_PID_FILE=" + pidFile.string() });
        host.Send("{\"type\":\"download\",\"url\":\"https://example.com/v\",\"outputDirectory\":\"" + out.string() + "\"}");
        auto tool = WaitPid(pidFile);
        Check(tool > 0, "eof: fake yt-dlp started");
        Check(host.Finish() == 0, "eof: host exits 0 while a job runs");
        Check(tool > 0 && Gone(tool), "eof: yt-dlp process is gone");
        Check(NoTempDirs(out), "eof: temp dir removed");
    }

    void TestSigtermCancelsJob()
    {
        auto out = NewDir("out");
        auto pidFile = g_tmp / "term.pid";
        HostProcess host({ "FAKE_YTDLP_MODE=hang", "FAKE_YTDLP_PID_FILE=" + pidFile.string() });
        host.Send("{\"type\":\"download\",\"url\":\"https://example.com/v\",\"outputDirectory\":\"" + out.string() + "\"}");
        auto tool = WaitPid(pidFile);
        Check(tool > 0, "sigterm: fake yt-dlp started");
        kill(host.pid, SIGTERM); // stdin stays open
        Check(host.Finish(false) == 0, "sigterm: host exits 0 with stdin still open");
        Check(tool > 0 && Gone(tool), "sigterm: yt-dlp process is gone");
        Check(NoTempDirs(out), "sigterm: temp dir removed");
    }
}

int main()
{
    TestParser();
    if (access("/bin/sh", X_OK) != 0 || std::string(MD_CLI_PATH).empty() || std::string(MD_FAKE_TOOLS_DIR).empty())
    {
        std::cout << "HostTests skipped: /bin/sh or CLI path unavailable\n";
        return g_failures == 0 ? 77 : 1;
    }
    std::signal(SIGPIPE, SIG_IGN);
    g_tmp = fs::temp_directory_path() / ("md-host-" + std::to_string(getpid()));
    fs::create_directories(g_tmp / "home");

    TestProbe();
    TestDownloadAndDoctor();
    TestDownloadFailure();
    TestInvalidMessages();
    TestBusyAndCancelYtDlp();
#ifdef __linux__
    TestPickFolderWithoutDisplay();
#endif
    TestCancelFfmpeg();
    TestEofCancelsJob();
    TestSigtermCancelsJob();

    std::error_code ignored;
    fs::remove_all(g_tmp, ignored);
    if (g_failures != 0) { std::cerr << g_failures << " check(s) failed\n"; return 1; }
    std::cout << "HostTests passed\n";
    return 0;
}
#endif
