// Freezes the CLI contract (stdout JSON events + exit codes) by running the built
// MediaDownloader.Cli against POSIX shell fake tools. Never touches the network.
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

#ifndef _WIN32
#include <sys/wait.h>
#include <unistd.h>
#endif

#ifndef MD_CLI_PATH
#define MD_CLI_PATH ""
#endif
#ifndef MD_FAKE_TOOLS_DIR
#define MD_FAKE_TOOLS_DIR ""
#endif

namespace fs = std::filesystem;
static int g_failures = 0;

[[maybe_unused]] static void Check(bool condition, std::string const& message)
{
    if (!condition) { ++g_failures; std::cerr << "FAIL: " << message << '\n'; }
}

#ifdef _WIN32
int main() { std::cout << "ContractTests skipped: POSIX shell fake tools required\n"; return 77; }
#else

namespace
{
    struct Result { int code{}; std::string out; std::vector<std::string> lines; std::string argv; };

    std::string Q(std::string const& s)
    {
        std::string r = "'";
        for (char c : s) r += c == '\'' ? std::string("'\\''") : std::string(1, c);
        return r + "'";
    }

    fs::path g_tmp, g_home, g_argvLog;
    int g_counter{};

    // env: extra KEY=VALUE assignments applied after the defaults (later wins).
    Result Run(std::vector<std::string> const& args, std::vector<std::string> const& env = {})
    {
        fs::path tools = MD_FAKE_TOOLS_DIR;
        std::error_code ignored;
        fs::remove(g_argvLog, ignored);
        std::string cmd = "cd " + Q(g_tmp.string()) + " && env -i HOME=" + Q(g_home.string()) +
            " PATH=/usr/bin:/bin FAKE_ARGV_LOG=" + Q(g_argvLog.string()) +
            " MEDIADOWNLOADER_YTDLP=" + Q((tools / "yt-dlp").string()) +
            " MEDIADOWNLOADER_FFMPEG=" + Q((tools / "ffmpeg").string()) +
            " MEDIADOWNLOADER_FFPROBE=" + Q((tools / "ffprobe").string()) +
            " MEDIADOWNLOADER_DENO=" + Q((tools / "deno").string());
        for (auto const& e : env) cmd += " " + Q(e);
        cmd += " " + Q(MD_CLI_PATH);
        for (auto const& a : args) cmd += " " + Q(a);
        cmd += " 2>/dev/null";

        Result result;
        FILE* pipe = popen(cmd.c_str(), "r");
        if (!pipe) { result.code = -1; return result; }
        char buffer[4096];
        size_t count;
        while ((count = fread(buffer, 1, sizeof buffer, pipe)) > 0) result.out.append(buffer, count);
        auto status = pclose(pipe);
        result.code = WIFEXITED(status) ? WEXITSTATUS(status) : -1;
        { std::ifstream log(g_argvLog); std::ostringstream all; all << log.rdbuf(); result.argv = all.str(); }
        std::istringstream stream(result.out);
        for (std::string line; std::getline(stream, line);) result.lines.push_back(line);
        return result;
    }

    bool Has(Result const& r, std::string const& needle)
    {
        for (auto const& l : r.lines) if (l.find(needle) != std::string::npos) return true;
        return false;
    }

    int IndexOf(Result const& r, std::string const& needle)
    {
        for (size_t i = 0; i < r.lines.size(); ++i)
            if (r.lines[i].find(needle) != std::string::npos) return static_cast<int>(i);
        return -1;
    }

    // Protocol invariant: every stdout line is exactly one JSON object.
    void CheckAllJson(Result const& r, std::string const& name)
    {
        Check(!r.lines.empty(), name + ": stdout is not empty");
        for (auto const& l : r.lines)
            Check(l.size() > 1 && l.front() == '{' && l.back() == '}' && l.find("{\"type\":\"") == 0,
                name + ": line is a typed JSON object: " + l);
    }

    fs::path NewDir(std::string const& name)
    {
        auto dir = g_tmp / (name + std::to_string(++g_counter));
        fs::create_directories(dir);
        return dir;
    }

    bool NoTempDirs(fs::path const& dir)
    {
        for (auto const& e : fs::directory_iterator(dir))
            if (e.path().filename().string().starts_with(".mediadownloader-")) return false;
        return true;
    }

    size_t CountFiles(fs::path const& dir)
    {
        size_t n = 0;
        for (auto const& e : fs::directory_iterator(dir)) if (e.is_regular_file()) ++n;
        return n;
    }

    void TestHelp()
    {
        for (auto const& args : { std::vector<std::string>{}, { "help" }, { "--help" }, { "-h" } })
        {
            auto r = Run(args);
            Check(r.code == 0, "help exits 0");
            for (auto const* s : { "doctor", "probe", "download", "host", "install-host", "--url", "--quality", "--format", "--title",
                "--start-time", "--end-time", "--max-size-mb", "--cookies-from-browser", "--output",
                "--overwrite", "--yt-dlp", "--ffmpeg", "--ffprobe" })
                Check(Has(r, s), std::string("help mentions ") + s);
            // Quirk: help is plain text, not a JSON event.
            Check(!r.lines.empty() && r.lines[0].front() != '{', "help is plain text");
        }
    }

    void TestInvalidArguments()
    {
        std::vector<std::vector<std::string>> cases{
            { "download" },
            { "probe" },
            { "download", "--url", "https://example.com/v", "--start-time", "5" },
            { "download", "--url", "https://example.com/v", "--end-time", "5" },
            { "download", "--url", "https://example.com/v", "--start-time", "10", "--end-time", "10" },
            { "download", "--url", "https://example.com/v", "--start-time", "10", "--end-time", "5" },
            { "download", "--url", "ftp://example.com/v" },
            { "download", "--url", "file:///etc/passwd" },
            { "download", "--url", "https://example.com/v", "--bogus" },
            { "bogus" },
        };
        for (auto const& args : cases)
        {
            auto r = Run(args);
            std::string name = "invalid_arguments(" + args.back() + ")";
            Check(r.code == 2, name + " exit 2");
            Check(r.lines.size() == 1 && r.lines[0].starts_with("{\"type\":\"error\",\"code\":\"invalid_arguments\",\"message\":\""),
                name + " emits invalid_arguments: " + r.out);
        }
    }

    void TestToolMissing()
    {
        auto empty = NewDir("emptypath");
        auto out = NewDir("out");
        std::string url = "https://example.com/v";
        auto r = Run({ "download", "--url", url, "--output", out.string() },
            { "PATH=" + empty.string(), "MEDIADOWNLOADER_YTDLP=/nonexistent/yt-dlp" });
        Check(r.code == 3, "missing yt-dlp exits 3");
        Check(r.lines.size() == 1 && r.lines[0].starts_with("{\"type\":\"error\",\"code\":\"tool_missing\""), "missing yt-dlp: tool_missing");

        r = Run({ "download", "--url", url, "--output", out.string() },
            { "PATH=" + empty.string(), "MEDIADOWNLOADER_FFMPEG=/nonexistent/ffmpeg" });
        Check(r.code == 3, "missing ffmpeg exits 3");
        Check(r.lines.size() == 1 && r.lines[0].starts_with("{\"type\":\"error\",\"code\":\"tool_missing\""), "missing ffmpeg: tool_missing");
        Check(CountFiles(out) == 0 && NoTempDirs(out), "missing ffmpeg: nothing created in output");

        r = Run({ "probe", "--url", url },
            { "PATH=" + empty.string(), "MEDIADOWNLOADER_YTDLP=/nonexistent/yt-dlp" });
        Check(r.code == 3 && Has(r, "\"code\":\"tool_missing\""), "probe without yt-dlp: tool_missing exit 3");

        // Only ffprobe is missing: yt-dlp/ffmpeg resolve from the fake tools.
        r = Run({ "download", "--url", url, "--output", out.string(), "--max-size-mb", "10" },
            { "PATH=" + empty.string(), "MEDIADOWNLOADER_FFPROBE=/nonexistent/ffprobe" });
        Check(r.code == 3 && Has(r, "\"code\":\"tool_missing\""), "missing ffprobe with size limit: tool_missing exit 3");
    }

    void TestDoctor()
    {
        auto r = Run({ "doctor" });
        Check(r.code == 0, "doctor exits 0 with all tools");
        CheckAllJson(r, "doctor");
        Check(r.lines.size() == 1 && r.lines[0].starts_with("{\"type\":\"doctor\",\"tools\":{\"yt-dlp\":{\"found\":true,\"path\":\""),
            "doctor shape: " + r.out);
        for (auto const* tool : { "\"ffmpeg\":{\"found\":true", "\"ffprobe\":{\"found\":true", "\"javascript-runtime\":{\"found\":true" })
            Check(Has(r, tool), std::string("doctor reports ") + tool);

        auto empty = NewDir("emptypath");
        r = Run({ "doctor" }, { "PATH=" + empty.string(), "MEDIADOWNLOADER_YTDLP=/nonexistent", "MEDIADOWNLOADER_DENO=/nonexistent" });
        Check(r.code == 3, "doctor exits 3 when a tool is missing");
        Check(Has(r, "\"yt-dlp\":{\"found\":false}"), "doctor reports missing tool as found:false without path");
        Check(Has(r, "\"javascript-runtime\":{\"found\":false}"), "doctor reports missing JS runtime");
    }

    void TestProbe()
    {
        auto r = Run({ "probe", "--url", "https://example.com/v" });
        Check(r.code == 0, "probe exits 0");
        CheckAllJson(r, "probe");
        Check(r.lines.size() == 1 && r.lines[0] == "{\"type\":\"probe\",\"data\":{\"id\":\"abc\",\"title\":\"Fake Title\",\"duration\":10}}",
            "probe wraps yt-dlp JSON in data: " + r.out);

        r = Run({ "probe", "--url", "https://example.com/v" }, { "FAKE_YTDLP_MODE=fail" });
        Check(r.code == 4, "probe failure exits 4");
        Check(r.lines.size() == 1 && r.lines[0].starts_with("{\"type\":\"error\",\"code\":\"probe_failed\",\"message\":\""), "probe failure: probe_failed");
    }

    void TestDownloadPlain()
    {
        auto out = NewDir("out");
        auto r = Run({ "download", "--url", "https://example.com/v", "--output", out.string() });
        Check(r.code == 0, "download exits 0");
        CheckAllJson(r, "download");
        auto file = (out / "Fake Title [abc].mp4").string();
        Check(r.lines.front() == "{\"type\":\"started\",\"outputDirectory\":\"" + out.string() + "\"}", "started is first: " + r.lines.front());
        int p42 = IndexOf(r, "{\"type\":\"progress\",\"stage\":\"download\",\"percent\":42.0}");
        Check(p42 > 0, "download progress 42.0 parsed from yt-dlp line (no pass field)");
        Check(Has(r, "{\"type\":\"progress\",\"stage\":\"download\",\"percent\":0.0}"), "download progress 0.0");
        Check(Has(r, "{\"type\":\"log\",\"level\":\"info\",\"message\":\"[info] abc: Downloading 1 format(s)\"}"), "other yt-dlp lines become info logs");
        Check(!Has(r, "[download] Destination:"), "Destination line is swallowed");
        Check(!Has(r, "__MD_FILE__"), "__MD_FILE__ marker is not echoed");
        Check(!Has(r, "\"encodingPlan\""), "no encodingPlan without --max-size-mb");
        Check(r.lines[r.lines.size() - 2] == "{\"type\":\"progress\",\"stage\":\"download\",\"percent\":100.0}", "final progress 100.0 before completed");
        Check(r.lines.back() == "{\"type\":\"completed\",\"path\":\"" + file + "\",\"bytes\":2048}", "completed path/bytes: " + r.lines.back());
        Check(fs::exists(file) && fs::file_size(file) == 2048, "final file exists in --output");
        Check(NoTempDirs(out) && CountFiles(out) == 1, "temp dir removed, only the final file remains");

        // Existing file: unique name "(2)"; --overwrite replaces; --title renames.
        r = Run({ "download", "--url", "https://example.com/v", "--output", out.string() });
        Check(r.code == 0 && Has(r, "Fake Title [abc] (2).mp4"), "second download gets (2) suffix");
        r = Run({ "download", "--url", "https://example.com/v", "--output", out.string(), "--overwrite" });
        Check(r.code == 0 && r.lines.back().find("Fake Title [abc].mp4\"") != std::string::npos, "--overwrite reuses the name");
        r = Run({ "download", "--url", "https://example.com/v", "--output", out.string(), "--title", "My: Clip?" });
        Check(r.code == 0 && Has(r, "/My") && Has(r, ".mp4\",\"bytes\""), "--title renames output: " + r.lines.back());
        Check(NoTempDirs(out), "temp dir removed after all runs");
    }

    void TestInstallHost()
    {
        auto r = Run({ "install-host" });
        auto manifest = g_home / (
#ifdef __APPLE__
            "Library/Application Support/Mozilla/NativeMessagingHosts/media_downloader.json"
#else
            ".mozilla/native-messaging-hosts/media_downloader.json"
#endif
        );
        Check(r.code == 0 && r.out.empty(), "install-host exits 0 with empty stdout");
        std::ifstream file(manifest);
        std::ostringstream all; all << file.rdbuf();
        auto text = all.str();
        Check(text.find("\"path\": \"" + fs::path(MD_CLI_PATH).string() + "\"") != std::string::npos, "install-host manifest points to the CLI");
        Check(text.find("mediadownloader@localhost") != std::string::npos, "install-host manifest has allowed_extensions");
        r = Run({ "install-host", "--bogus" });
        Check(r.code == 2, "install-host rejects extra arguments");
    }

    void TestDefaultOutput()
    {
        auto r = Run({ "download", "--url", "https://example.com/v" });
        auto videos = g_home / "Videos";
        Check(r.code == 0, "download to default folder exits 0");
        Check(r.lines.front() == "{\"type\":\"started\",\"outputDirectory\":\"" + videos.string() + "\"}", "default output is $HOME/Videos");
        Check(fs::exists(videos / "Fake Title [abc].mp4"), "file lands in $HOME/Videos");
        Check(NoTempDirs(videos), "temp dir removed in $HOME/Videos");
    }

    void TestOutputFallback()
    {
        auto bad = g_tmp / "not-a-dir.txt";
        { std::ofstream(bad) << "x"; }
        auto r = Run({ "download", "--url", "https://example.com/v", "--output", bad.string() });
        auto videos = g_home / "Videos";
        Check(r.code == 0, "unusable --output falls back to Videos and exits 0");
        Check(r.out.find("\"level\":\"warning\",\"message\":\"Dossier de sortie inutilisable (" + bad.string() + "), enregistrement dans le dossier Vidéos : " + videos.string() + "\"") != std::string::npos, "fallback warning names both paths");
        Check(r.out.find("{\"type\":\"started\",\"outputDirectory\":\"" + videos.string() + "\"}") != std::string::npos, "started reports the Videos folder");
        Check(fs::exists(videos / "Fake Title [abc].mp4"), "file lands in Videos after fallback");
    }

    void TestDownloadEncode()
    {
        auto out = NewDir("out");
        auto r = Run({ "download", "--url", "https://example.com/v", "--output", out.string(), "--max-size-mb", "10" },
            { "FAKE_DURATION=10", "FAKE_ENCODED_BYTES=4096", "FAKE_SOURCE_BYTES=100000" });
        Check(r.code == 0, "encode download exits 0: " + r.out);
        CheckAllJson(r, "encode");
        int plan = IndexOf(r, "{\"type\":\"encodingPlan\",\"durationSeconds\":10.000000,\"videoKbps\":8008,\"audioKbps\":128}");
        int p1 = IndexOf(r, "{\"type\":\"progress\",\"stage\":\"encode\",\"percent\":25.0,\"pass\":1}");
        int p2 = IndexOf(r, "{\"type\":\"progress\",\"stage\":\"encode\",\"percent\":75.0,\"pass\":2}");
        int done = IndexOf(r, "{\"type\":\"completed\"");
        Check(plan > 0, "encodingPlan emitted with expected numbers: " + r.out);
        Check(plan < p1 && p1 < p2 && p2 < done, "order: encodingPlan, pass 1, pass 2, completed");
        Check(r.lines[r.lines.size() - 2] == "{\"type\":\"progress\",\"stage\":\"encode\",\"percent\":100.0,\"pass\":2}", "final encode progress 100.0 pass 2");
        Check(r.lines.back() == "{\"type\":\"completed\",\"path\":\"" + (out / "Fake Title [abc].mp4").string() + "\",\"bytes\":4096}",
            "completed reports the encoded file: " + r.lines.back());
        Check(!Has(r, "out_time_us"), "ffmpeg progress lines are not echoed");
        Check(NoTempDirs(out) && CountFiles(out) == 1, "encode: temp dir removed, one file left");

        auto out2 = NewDir("out");
        r = Run({ "download", "--url", "https://example.com/v", "--output", out2.string(), "--max-size-mb", "1" },
            { "FAKE_DURATION=100000" });
        Check(r.code == 4, "size_unreachable exits 4");
        Check(r.lines.back() == "{\"type\":\"error\",\"code\":\"size_unreachable\",\"message\":\"La durée est trop importante pour la taille demandée\"}",
            "size_unreachable event: " + r.lines.back());
        Check(!Has(r, "encodingPlan"), "no encodingPlan when unreachable");
        Check(NoTempDirs(out2) && CountFiles(out2) == 0, "size_unreachable leaves nothing behind");

        auto out3 = NewDir("out");
        r = Run({ "download", "--url", "https://example.com/v", "--output", out3.string(), "--max-size-mb", "1" },
            { "FAKE_DURATION=10", "FAKE_ENCODED_BYTES=2000000" });
        Check(r.code == 4, "size_exceeded exits 4");
        Check(r.lines.back().starts_with("{\"type\":\"error\",\"code\":\"size_exceeded\""), "size_exceeded event: " + r.lines.back());
        Check(Has(r, "\"encodingPlan\"") && !Has(r, "\"completed\""), "size_exceeded: plan emitted, no completed");
        Check(NoTempDirs(out3) && CountFiles(out3) == 0, "size_exceeded leaves nothing behind");

        // Quirk: --max-size-mb requires mp4.
        r = Run({ "download", "--url", "https://example.com/v", "--max-size-mb", "5", "--format", "mkv" });
        Check(r.code == 2 && Has(r, "invalid_arguments"), "--max-size-mb with mkv is invalid_arguments");
    }

    void TestDownloadFailure()
    {
        auto out = NewDir("out");
        auto r = Run({ "download", "--url", "https://example.com/v", "--output", out.string() }, { "FAKE_YTDLP_MODE=fail" });
        Check(r.code == 4, "download failure exits 4");
        Check(r.lines.front().starts_with("{\"type\":\"started\""), "started precedes failure");
        Check(r.lines.back().starts_with("{\"type\":\"error\",\"code\":\"download_failed\",\"message\":\""), "download_failed event: " + r.lines.back());
        Check(Has(r, "boom"), "failure message carries yt-dlp error text");
        Check(NoTempDirs(out) && CountFiles(out) == 0, "failure leaves nothing behind");
    }

    // The argv log has one line per tool call: "<tool path> <args...>".
    std::string ToolLine(Result const& r, std::string const& toolPath)
    {
        std::istringstream stream(r.argv);
        for (std::string line; std::getline(stream, line);)
            if (line.starts_with(toolPath + " ")) return line;
        return {};
    }

    bool Contains(std::string const& haystack, std::string const& needle) { return haystack.find(needle) != std::string::npos; }

    void TestArguments()
    {
        fs::path tools = MD_FAKE_TOOLS_DIR;
        auto ytdlp = (tools / "yt-dlp").string(), ffmpeg = (tools / "ffmpeg").string();
        auto out = NewDir("out");
        std::string url = "https://example.com/v";

        auto r = Run({ "download", "--url", url, "--output", out.string() });
        auto y = ToolLine(r, ytdlp);
        Check(Contains(y, " --format bestvideo+bestaudio/best "), "default quality selector: " + y);
        Check(Contains(y, " --merge-output-format mp4 "), "default merge format mp4");
        Check(Contains(y, " --ffmpeg-location " + tools.string() + " "), "ffmpeg-location is the ffmpeg directory");
        Check(Contains(y, " --js-runtimes deno:" + (tools / "deno").string() + " "), "JS runtime passed to yt-dlp");
        Check(Contains(y, " --newline --no-color --no-playlist --windows-filenames --no-overwrites "), "fixed yt-dlp flags");
        Check(Contains(y, " --print after_move:__MD_FILE__:%(filepath)s"), "after_move print template");
        Check(!Contains(y, "--cookies-from-browser"), "no cookies on non-YouTube URL with auto");
        Check(!Contains(y, "--download-sections") && !Contains(y, "--force-keyframes-at-cuts"), "no section flags without a range");
        Check(y.size() > url.size() && y.substr(y.size() - url.size()) == url, "URL is the last yt-dlp argument");

        r = Run({ "download", "--url", url, "--output", out.string(), "--quality", "720", "--format", "mkv" });
        y = ToolLine(r, ytdlp);
        Check(Contains(y, " --format bestvideo[height<=720]+bestaudio/best[height<=720]/best "), "720 quality selector: " + y);
        Check(Contains(y, " --merge-output-format mkv "), "mkv merge format");

        // Cookies.
        std::string yt = "https://www.youtube.com/watch?v=abc";
        r = Run({ "download", "--url", yt, "--output", out.string() });
        Check(Contains(ToolLine(r, ytdlp), " --cookies-from-browser firefox "), "auto + YouTube gives firefox");
        r = Run({ "download", "--url", "https://notyoutube.com.evil.example/v", "--output", out.string() });
        Check(!Contains(ToolLine(r, ytdlp), "--cookies-from-browser"), "look-alike host gets no cookies");
        r = Run({ "download", "--url", url, "--output", out.string(), "--cookies-from-browser", "Chrome" });
        Check(Contains(ToolLine(r, ytdlp), " --cookies-from-browser chrome "), "explicit browser passes through (lowercased)");
        r = Run({ "probe", "--url", yt });
        y = ToolLine(r, ytdlp);
        Check(Contains(y, "--dump-single-json --no-playlist --no-warnings --quiet") && Contains(y, " --cookies-from-browser firefox "),
            "probe args and YouTube cookies: " + y);
        r = Run({ "probe", "--url", url, "--cookies-from-browser", "edge" });
        Check(Contains(ToolLine(r, ytdlp), " --cookies-from-browser edge "), "probe explicit browser");

        // Clip range.
        r = Run({ "download", "--url", url, "--output", out.string(), "--start-time", "10", "--end-time", "20" });
        y = ToolLine(r, ytdlp);
        Check(Contains(y, " --download-sections *10-20 --force-keyframes-at-cuts "), "clip flags: " + y);
        Check(r.code == 0 && r.lines.back().find("\"bytes\":2048}") != std::string::npos, "clip download completes");

        // Encoding: scale filter only when a height is requested.
        r = Run({ "download", "--url", url, "--output", out.string(), "--max-size-mb", "10", "--quality", "720" });
        Check(Contains(r.argv, ffmpeg + " -y -i ") && Contains(r.argv, " -vf scale=-2:min(ih\\,720) "), "ffmpeg scale filter for 720: " + r.argv);
        Check(Contains(r.argv, " -c:v libx264 ") && Contains(r.argv, " -pass 1 ") && Contains(r.argv, " -pass 2 "), "two-pass libx264");
        r = Run({ "download", "--url", url, "--output", out.string(), "--max-size-mb", "10" });
        Check(!Contains(r.argv, "scale="), "no scale filter for best");

        // Clip + size limit: the plan uses the duration ffprobe reports for the downloaded file.
        r = Run({ "download", "--url", url, "--output", out.string(), "--max-size-mb", "10", "--start-time", "10", "--end-time", "15" },
            { "FAKE_DURATION=5", "FAKE_ENCODED_BYTES=4096" });
        Check(r.code == 0, "clip + max-size exits 0: " + r.out);
        Check(Has(r, "{\"type\":\"encodingPlan\",\"durationSeconds\":5.000000,"), "encodingPlan uses probed clip duration: " + r.out);
        Check(Contains(ToolLine(r, ytdlp), " --download-sections *10-15 "), "clip + max-size passes the section");
    }

    void TestToolFlags()
    {
        fs::path tools = MD_FAKE_TOOLS_DIR;
        auto alt = NewDir("alt");
        for (auto const* n : { "yt-dlp", "ffmpeg", "ffprobe" }) fs::copy_file(tools / n, alt / n);
        auto out = NewDir("out");
        auto r = Run({ "download", "--url", "https://example.com/v", "--output", out.string(), "--max-size-mb", "10",
            "--yt-dlp", (alt / "yt-dlp").string(), "--ffmpeg", (alt / "ffmpeg").string(), "--ffprobe", (alt / "ffprobe").string() });
        Check(r.code == 0, "download with explicit tool flags exits 0: " + r.out);
        for (auto const* n : { "yt-dlp", "ffmpeg", "ffprobe" })
        {
            Check(!ToolLine(r, (alt / n).string()).empty(), std::string("--") + n + " flag selects the tool");
            Check(ToolLine(r, (tools / n).string()).empty(), std::string("env ") + n + " is not used when the flag is given");
        }
        Check(Contains(ToolLine(r, (alt / "yt-dlp").string()), " --ffmpeg-location " + alt.string() + " "), "ffmpeg-location follows --ffmpeg");

        r = Run({ "doctor", "--yt-dlp", (alt / "yt-dlp").string() });
        Check(Has(r, "\"yt-dlp\":{\"found\":true,\"path\":\"" + (alt / "yt-dlp").string() + "\"}"), "doctor honours --yt-dlp: " + r.out);
        r = Run({ "probe", "--url", "https://example.com/v", "--yt-dlp", (alt / "yt-dlp").string() });
        Check(!ToolLine(r, (alt / "yt-dlp").string()).empty(), "probe honours --yt-dlp");
    }

    void TestOrphanCleanup()
    {
        auto out = NewDir("out");
        auto dead = out / ".mediadownloader-999999999-1";
        auto live = out / (".mediadownloader-" + std::to_string(getpid()) + "-1");
        auto unrelated = out / ".mediadownloader-notapid-1";
        for (auto const& d : { dead, live, unrelated }) { fs::create_directories(d); std::ofstream(d / "x.part") << "x"; }
        auto r = Run({ "download", "--url", "https://example.com/v", "--output", out.string() });
        Check(r.code == 0, "download with orphans exits 0");
        Check(!fs::exists(dead), "dead-pid temp dir removed");
        Check(fs::exists(live), "live-pid temp dir kept");
        Check(fs::exists(unrelated), "temp dir with unparsable name kept");
        Check(Has(r, "{\"type\":\"log\",\"level\":\"info\",\"message\":\"Dossier temporaire orphelin supprimé : " + dead.string() + "\"}"),
            "info log for removed orphan: " + r.out);
        Check(IndexOf(r, "orphelin") < IndexOf(r, "\"type\":\"started\""), "orphan log precedes started");
    }

    void TestProcessingFailed()
    {
        std::string url = "https://example.com/v";
        auto expectError = [&](std::vector<std::string> env, std::string const& message, std::string const& name)
        {
            auto out = NewDir("out");
            auto r = Run({ "download", "--url", url, "--output", out.string(), "--max-size-mb", "10" }, env);
            Check(r.code == 4, name + " exits 4");
            Check(r.lines.back() == "{\"type\":\"error\",\"code\":\"processing_failed\",\"message\":\"" + message + "\"}", name + ": " + r.lines.back());
            Check(NoTempDirs(out) && CountFiles(out) == 0, name + " leaves nothing behind");
        };
        expectError({ "FAKE_FFMPEG_MODE=fail" }, "FFmpeg a échoué pendant l'encodage passe 1", "ffmpeg failure");
        expectError({ "FAKE_FFMPEG_MODE=nofile" }, "FFmpeg n'a pas produit le fichier attendu", "ffmpeg without output");
        expectError({ "FAKE_PROBE_OUTPUT=abc" }, "La durée retournée par ffprobe est invalide", "invalid ffprobe duration");
        expectError({ "FAKE_PROBE_OUTPUT=0" }, "La durée retournée par ffprobe est invalide", "zero ffprobe duration");

        // Warning log when no JavaScript runtime exists (PATH holds only head, needed by the fakes).
        auto bin = NewDir("bin");
        for (auto const* head : { "/usr/bin/head", "/bin/head" })
            if (fs::exists(head)) { fs::create_symlink(head, bin / "head"); break; }
        auto out = NewDir("out");
        auto r = Run({ "download", "--url", url, "--output", out.string() },
            { "PATH=" + bin.string(), "MEDIADOWNLOADER_DENO=/nonexistent", "MEDIADOWNLOADER_NODE=/nonexistent" });
        Check(r.code == 0, "download without JS runtime still succeeds: " + r.out);
        Check(Has(r, "{\"type\":\"log\",\"level\":\"warning\",\"message\":\"Aucun runtime JavaScript compatible n'a été trouvé ; certains liens YouTube peuvent échouer.\"}"),
            "warning log without JS runtime");
        Check(!Contains(ToolLine(r, (fs::path(MD_FAKE_TOOLS_DIR) / "yt-dlp").string()), "--js-runtimes"), "no --js-runtimes flag without runtime");
    }
}

int main()
{
    if (access("/bin/sh", X_OK) != 0 || std::string(MD_CLI_PATH).empty() || std::string(MD_FAKE_TOOLS_DIR).empty())
    {
        std::cout << "ContractTests skipped: /bin/sh or CLI path unavailable\n";
        return 77; // CTest SKIP_RETURN_CODE
    }
    g_tmp = fs::temp_directory_path() / ("md-contract-" + std::to_string(getpid()));
    g_home = g_tmp / "home";
    g_argvLog = g_tmp / "argv.log";
    fs::create_directories(g_home);

    TestHelp();
    TestInvalidArguments();
    TestToolMissing();
    TestDoctor();
    TestProbe();
    TestDownloadPlain();
    TestInstallHost();
    TestDefaultOutput();
    TestOutputFallback();
    TestDownloadEncode();
    TestDownloadFailure();
    TestArguments();
    TestToolFlags();
    TestOrphanCleanup();
    TestProcessingFailed();

    std::error_code ignored;
    fs::remove_all(g_tmp, ignored);
    if (g_failures) { std::cerr << g_failures << " contract check(s) failed\n"; return 1; }
    std::cout << "All contract tests passed\n";
    return 0;
}
#endif
