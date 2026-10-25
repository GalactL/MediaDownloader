#include "Host.h"
#include "ChildProcess.h"
#include "Core.h"

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <csignal>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <functional>
#include <iomanip>
#include <locale>
#include <mutex>
#include <set>
#include <sstream>
#include <thread>
#include <type_traits>

namespace media_downloader
{
    namespace
    {
        constexpr std::size_t kMaxIncoming = 4u * 1024 * 1024; // protocol limit for requests
        constexpr std::size_t kMaxOutgoing = 1024 * 1024;      // Firefox limit for native host responses

        std::string ToolJson(char const* name, DoctorTool const& tool)
        {
            return std::string("\"") + name + "\":{\"found\":" + (tool.found ? "true" : "false") +
                (tool.found ? ",\"path\":\"" + JsonEscape(tool.path) + "\"}" : "}");
        }

        std::string ErrorJson(std::string const& code, std::string const& message)
        {
            return SerializeEvent(ErrorEvent{ code, message });
        }

        // ---- JSON parser -------------------------------------------------------------------------------

        class Parser
        {
        public:
            explicit Parser(std::string_view text) : s_(text) {}

            std::optional<Json> Document()
            {
                Json value;
                if (!Value(value, 0)) return std::nullopt;
                Space();
                if (i_ != s_.size()) return std::nullopt;
                return value;
            }

        private:
            std::string_view s_;
            std::size_t i_{};

            void Space() { while (i_ < s_.size() && (s_[i_] == ' ' || s_[i_] == '\t' || s_[i_] == '\n' || s_[i_] == '\r')) ++i_; }
            bool Eat(char c) { if (i_ < s_.size() && s_[i_] == c) { ++i_; return true; } return false; }
            bool Literal(std::string_view word) { if (s_.substr(i_, word.size()) != word) return false; i_ += word.size(); return true; }

            bool Value(Json& out, int depth)
            {
                if (depth > 64) return false;
                Space();
                if (i_ >= s_.size()) return false;
                switch (s_[i_])
                {
                case '{': return Object(out, depth);
                case '[': return Array(out, depth);
                case '"': out.type = Json::Type::String; return String(out.string);
                case 't': out.type = Json::Type::Bool; out.boolean = true; return Literal("true");
                case 'f': out.type = Json::Type::Bool; out.boolean = false; return Literal("false");
                case 'n': out.type = Json::Type::Null; return Literal("null");
                default: return Number(out);
                }
            }

            bool Object(Json& out, int depth)
            {
                out.type = Json::Type::Object;
                ++i_;
                Space();
                if (Eat('}')) return true;
                for (;;)
                {
                    Space();
                    std::string key;
                    if (i_ >= s_.size() || s_[i_] != '"' || !String(key)) return false;
                    Space();
                    if (!Eat(':')) return false;
                    Json value;
                    if (!Value(value, depth + 1)) return false;
                    out.object.emplace_back(std::move(key), std::move(value));
                    Space();
                    if (Eat('}')) return true;
                    if (!Eat(',')) return false;
                }
            }

            bool Array(Json& out, int depth)
            {
                out.type = Json::Type::Array;
                ++i_;
                Space();
                if (Eat(']')) return true;
                for (;;)
                {
                    Json value;
                    if (!Value(value, depth + 1)) return false;
                    out.array.push_back(std::move(value));
                    Space();
                    if (Eat(']')) return true;
                    if (!Eat(',')) return false;
                }
            }

            bool Number(Json& out)
            {
                auto digits = [this] { auto start = i_; while (i_ < s_.size() && s_[i_] >= '0' && s_[i_] <= '9') ++i_; return i_ > start; };
                auto start = i_;
                Eat('-');
                if (Eat('0')) {} else if (!digits()) return false;
                if (Eat('.') && !digits()) return false;
                if (i_ < s_.size() && (s_[i_] == 'e' || s_[i_] == 'E'))
                {
                    ++i_;
                    if (!Eat('+')) Eat('-');
                    if (!digits()) return false;
                }
                out.type = Json::Type::Number;
                out.number = std::strtod(std::string(s_.substr(start, i_ - start)).c_str(), nullptr);
                return true;
            }

            bool Hex4(std::uint32_t& out)
            {
                if (i_ + 4 > s_.size()) return false;
                out = 0;
                for (int k = 0; k < 4; ++k)
                {
                    char c = s_[i_++];
                    out <<= 4;
                    if (c >= '0' && c <= '9') out |= static_cast<std::uint32_t>(c - '0');
                    else if (c >= 'a' && c <= 'f') out |= static_cast<std::uint32_t>(c - 'a' + 10);
                    else if (c >= 'A' && c <= 'F') out |= static_cast<std::uint32_t>(c - 'A' + 10);
                    else return false;
                }
                return true;
            }

            static void AppendUtf8(std::string& out, std::uint32_t cp)
            {
                if (cp < 0x80) out += static_cast<char>(cp);
                else if (cp < 0x800) { out += static_cast<char>(0xC0 | (cp >> 6)); out += static_cast<char>(0x80 | (cp & 0x3F)); }
                else if (cp < 0x10000)
                {
                    out += static_cast<char>(0xE0 | (cp >> 12)); out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
                    out += static_cast<char>(0x80 | (cp & 0x3F));
                }
                else
                {
                    out += static_cast<char>(0xF0 | (cp >> 18)); out += static_cast<char>(0x80 | ((cp >> 12) & 0x3F));
                    out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F)); out += static_cast<char>(0x80 | (cp & 0x3F));
                }
            }

            // Copies one multi-byte UTF-8 sequence whose lead byte was just consumed; rejects invalid ones
            // (bad lead/continuation, overlong, surrogates, > U+10FFFF).
            bool Utf8Tail(unsigned char lead, std::string& out)
            {
                int extra = lead >= 0xF0 ? 3 : lead >= 0xE0 ? 2 : 1;
                if (lead < 0xC2 || lead > 0xF4) return false;
                std::uint32_t cp = lead & (0x3F >> extra);
                out += static_cast<char>(lead);
                for (int k = 0; k < extra; ++k)
                {
                    if (i_ >= s_.size() || (static_cast<unsigned char>(s_[i_]) & 0xC0) != 0x80) return false;
                    cp = (cp << 6) | (static_cast<unsigned char>(s_[i_]) & 0x3F);
                    out += s_[i_++];
                }
                return !(extra == 2 && (cp < 0x800 || (cp >= 0xD800 && cp <= 0xDFFF))) &&
                    !(extra == 3 && (cp < 0x10000 || cp > 0x10FFFF));
            }

            bool String(std::string& out)
            {
                ++i_; // opening quote
                while (i_ < s_.size())
                {
                    unsigned char c = static_cast<unsigned char>(s_[i_++]);
                    if (c == '"') return true;
                    if (c < 0x20) return false;
                    if (c >= 0x80) { if (!Utf8Tail(c, out)) return false; continue; }
                    if (c != '\\') { out += static_cast<char>(c); continue; }
                    if (i_ >= s_.size()) return false;
                    switch (s_[i_++])
                    {
                    case '"': out += '"'; break;
                    case '\\': out += '\\'; break;
                    case '/': out += '/'; break;
                    case 'b': out += '\b'; break;
                    case 'f': out += '\f'; break;
                    case 'n': out += '\n'; break;
                    case 'r': out += '\r'; break;
                    case 't': out += '\t'; break;
                    case 'u':
                    {
                        std::uint32_t cp{};
                        if (!Hex4(cp)) return false;
                        if (cp >= 0xDC00 && cp <= 0xDFFF) return false; // lone low surrogate
                        if (cp >= 0xD800 && cp <= 0xDBFF)
                        {
                            std::uint32_t low{};
                            if (!Eat('\\') || !Eat('u') || !Hex4(low) || low < 0xDC00 || low > 0xDFFF) return false;
                            cp = 0x10000 + ((cp - 0xD800) << 10) + (low - 0xDC00);
                        }
                        AppendUtf8(out, cp);
                        break;
                    }
                    default: return false;
                    }
                }
                return false;
            }
        };

        // ---- probe summary -----------------------------------------------------------------------------

        std::string FormatNumber(double value)
        {
            std::ostringstream out;
            out.imbue(std::locale::classic());
            out << std::setprecision(15) << value;
            return out.str();
        }

        // Keeps the probe response far below the 1 MiB native messaging limit.
        std::optional<std::string> CompactProbe(std::string const& raw)
        {
            auto document = ParseJson(raw);
            if (!document || document->type != Json::Type::Object) return std::nullopt;
            std::string out = "{";
            for (auto const* key : { "id", "title", "duration", "uploader", "thumbnail", "webpage_url" })
            {
                auto const* value = document->Get(key);
                if (!value) continue;
                if (value->type == Json::Type::String)
                    out += std::string("\"") + key + "\":\"" + JsonEscape(value->string) + "\",";
                else if (value->type == Json::Type::Number && std::isfinite(value->number))
                    out += std::string("\"") + key + "\":" + FormatNumber(value->number) + ",";
            }
            std::set<long long> heights;
            if (auto const* formats = document->Get("formats"); formats && formats->type == Json::Type::Array)
                for (auto const& format : formats->array)
                    if (auto const* height = format.type == Json::Type::Object ? format.Get("height") : nullptr;
                        height && height->type == Json::Type::Number && height->number >= 1 && height->number < 1e6)
                        heights.insert(static_cast<long long>(height->number));
            out += "\"heights\":[";
            for (auto it = heights.begin(); it != heights.end(); ++it)
                out += (it == heights.begin() ? "" : ",") + std::to_string(*it);
            return out + "]}";
        }

        // ---- framing and output ------------------------------------------------------------------------

        enum class ReadResult { Ok, Eof, TooLarge };

        ReadResult ReadMessage(std::FILE* in, std::string& body)
        {
            std::uint32_t length{};
            if (std::fread(&length, 1, sizeof length, in) != sizeof length) return ReadResult::Eof;
            if (length > kMaxIncoming)
            {
                char buffer[65536];
                for (std::uint64_t left = length; left > 0;)
                {
                    auto chunk = static_cast<std::size_t>(std::min<std::uint64_t>(left, sizeof buffer));
                    if (std::fread(buffer, 1, chunk, in) != chunk) return ReadResult::Eof;
                    left -= chunk;
                }
                return ReadResult::TooLarge;
            }
            body.resize(length);
            if (length > 0 && std::fread(body.data(), 1, length, in) != length) return ReadResult::Eof;
            return ReadResult::Ok;
        }

        // Inserts "id" right after the "type" member of a serialized event.
        std::string WithId(std::string json, std::optional<std::string> const& id)
        {
            if (!id) return json;
            auto end = json.find('"', std::strlen("{\"type\":\""));
            json.insert(end + 1, ",\"id\":\"" + JsonEscape(*id) + "\"");
            return json;
        }

        class Output
        {
        public:
            explicit Output(std::FILE* file) : file_(file) {}

            void Send(std::string json, std::optional<std::string> const& id)
            {
                json = WithId(std::move(json), id);
                if (json.size() > kMaxOutgoing)
                    json = WithId(ErrorJson("message_too_large", "La réponse dépasse la taille maximale autorisée."), id);
                auto length = static_cast<std::uint32_t>(json.size());
                std::scoped_lock lock(mutex_);
                if (failed_) return;
                if (std::fwrite(&length, 1, sizeof length, file_) != sizeof length ||
                    std::fwrite(json.data(), 1, json.size(), file_) != json.size() || std::fflush(file_) != 0)
                    failed_ = true; // stdout is gone: nobody is listening any more
            }

            bool Failed() const { return failed_; }

        private:
            std::FILE* file_;
            std::mutex mutex_;
            std::atomic_bool failed_{};
        };

        // Per-job sink: adds the request id, summarizes probes and reports the end of the job before
        // its terminal event so the client can immediately send the next request.
        class HostSink : public EventSink
        {
        public:
            HostSink(Output& output, std::optional<std::string> id, std::function<void()> onTerminal = {},
                std::function<void(std::string const&)> onCompleted = {})
                : output_(output), id_(std::move(id)), onTerminal_(std::move(onTerminal)), onCompleted_(std::move(onCompleted)) {}

            void On(Event const& event) override
            {
                bool terminal = std::holds_alternative<CompletedEvent>(event) || std::holds_alternative<ErrorEvent>(event) ||
                    std::holds_alternative<ProbeEvent>(event);
                if (auto const* completed = std::get_if<CompletedEvent>(&event); completed && onCompleted_) onCompleted_(completed->path);
                std::string json;
                if (auto const* probe = std::get_if<ProbeEvent>(&event))
                {
                    auto compact = CompactProbe(probe->json);
                    json = compact ? "{\"type\":\"probe\",\"data\":" + *compact + "}"
                                   : ErrorJson("processing_failed", "Réponse yt-dlp illisible.");
                }
                else json = SerializeEvent(event);
                if (terminal && onTerminal_) onTerminal_();
                output_.Send(std::move(json), id_);
            }

        private:
            Output& output_;
            std::optional<std::string> id_;
            std::function<void()> onTerminal_;
            std::function<void(std::string const&)> onCompleted_;
        };

        // Opens a folder in the system file manager. execv-based RunProcess needs absolute paths.
        bool OpenFolder(std::string const& directory)
        {
            std::filesystem::path opener;
#ifdef _WIN32
            wchar_t* root = nullptr;
            _wdupenv_s(&root, nullptr, L"SystemRoot");
            opener = std::filesystem::path(root ? root : L"C:\\Windows") / L"explorer.exe";
            std::free(root);
#elif defined(__APPLE__)
            opener = "/usr/bin/open";
#else
            opener = "/usr/bin/xdg-open";
#endif
            std::atomic_bool never{};
            try
            {
                auto result = RunProcess(opener, { Utf8ToWide(directory) }, std::filesystem::path(Utf8ToWide(directory)), [](std::string const&) {}, never);
                return result.exitCode == 0 || (opener.filename() == "explorer.exe" && result.exitCode == 1); // explorer returns 1 on success
            }
            catch (...) { return false; } // e.g. the folder was deleted
        }

        // ---- requests ----------------------------------------------------------------------------------

        bool AddString(Json const& request, char const* key, char const* flag, std::vector<std::wstring>& args, std::string& error)
        {
            auto const* value = request.Get(key);
            if (!value || value->type == Json::Type::Null) return true;
            if (value->type != Json::Type::String) { error = std::string("Le champ ") + key + " doit être une chaîne."; return false; }
            args.push_back(Utf8ToWide(flag));
            args.push_back(Utf8ToWide(value->string));
            return true;
        }

        bool AddNumber(Json const& request, char const* key, char const* flag, std::vector<std::wstring>& args, std::string& error)
        {
            auto const* value = request.Get(key);
            if (!value || value->type == Json::Type::Null) return true;
            if (value->type != Json::Type::Number) { error = std::string("Le champ ") + key + " doit être un nombre."; return false; }
            std::ostringstream text;
            text.imbue(std::locale::classic());
            text << std::setprecision(17) << value->number;
            args.push_back(Utf8ToWide(flag));
            args.push_back(Utf8ToWide(text.str()));
            return true;
        }

        // Builds the CLI-equivalent argument vector so validation is exactly ParseArguments.
        bool BuildArguments(std::string const& type, Json const& request, std::vector<std::wstring>& args, std::string& error)
        {
            args = { Utf8ToWide(type) };
            if (type == "doctor") return true;
            if (type == "probe")
                return AddString(request, "url", "--url", args, error) &&
                    AddString(request, "cookiesFromBrowser", "--cookies-from-browser", args, error);
            if (!(AddString(request, "url", "--url", args, error) && AddString(request, "quality", "--quality", args, error) &&
                AddString(request, "format", "--format", args, error) && AddString(request, "title", "--title", args, error) &&
                AddNumber(request, "startTime", "--start-time", args, error) && AddNumber(request, "endTime", "--end-time", args, error) &&
                AddNumber(request, "maxSizeMb", "--max-size-mb", args, error) &&
                AddString(request, "cookiesFromBrowser", "--cookies-from-browser", args, error) &&
                AddString(request, "outputDirectory", "--output", args, error)))
                return false;
            if (auto const* overwrite = request.Get("overwrite"); overwrite && overwrite->type != Json::Type::Null)
            {
                if (overwrite->type != Json::Type::Bool) { error = "Le champ overwrite doit être un booléen."; return false; }
                if (overwrite->boolean) args.push_back(L"--overwrite");
            }
            return true;
        }
    }

    std::string SerializeEvent(Event const& event)
    {
        return std::visit([](auto const& e) -> std::string
        {
            using T = std::decay_t<decltype(e)>;
            if constexpr (std::is_same_v<T, StartedEvent>)
                return "{\"type\":\"started\",\"outputDirectory\":\"" + JsonEscape(e.outputDirectory) + "\"}";
            else if constexpr (std::is_same_v<T, LogEvent>)
                return "{\"type\":\"log\",\"level\":\"" + JsonEscape(e.level) + "\",\"message\":\"" + JsonEscape(e.message) + "\"}";
            else if constexpr (std::is_same_v<T, ProgressEvent>)
            {
                std::ostringstream json;
                json << "{\"type\":\"progress\",\"stage\":\"" << e.stage << "\",\"percent\":"
                     << std::fixed << std::setprecision(1) << e.percent;
                if (e.pass > 0) json << ",\"pass\":" << e.pass;
                json << '}';
                return json.str();
            }
            else if constexpr (std::is_same_v<T, EncodingPlanEvent>)
                return "{\"type\":\"encodingPlan\",\"durationSeconds\":" + std::to_string(e.durationSeconds) +
                    ",\"videoKbps\":" + std::to_string(e.videoKbps) + ",\"audioKbps\":" + std::to_string(e.audioKbps) + "}";
            else if constexpr (std::is_same_v<T, CompletedEvent>)
                return "{\"type\":\"completed\",\"path\":\"" + JsonEscape(e.path) + "\",\"bytes\":" + std::to_string(e.bytes) + "}";
            else if constexpr (std::is_same_v<T, ErrorEvent>)
                return "{\"type\":\"error\",\"code\":\"" + JsonEscape(e.code) + "\",\"message\":\"" + JsonEscape(e.message) + "\"}";
            else if constexpr (std::is_same_v<T, DoctorEvent>)
                return "{\"type\":\"doctor\",\"tools\":{" + ToolJson("yt-dlp", e.ytDlp) + ',' + ToolJson("ffmpeg", e.ffmpeg) + ',' +
                    ToolJson("ffprobe", e.ffprobe) + ',' + ToolJson("javascript-runtime", e.javascriptRuntime) + "}}";
            else
                return "{\"type\":\"probe\",\"data\":" + e.json + "}";
        }, event);
    }

    Json const* Json::Get(std::string_view key) const
    {
        if (type != Type::Object) return nullptr;
        for (auto it = object.rbegin(); it != object.rend(); ++it)
            if (it->first == key) return &it->second;
        return nullptr;
    }

    std::optional<Json> ParseJson(std::string_view text) { return Parser(text).Document(); }

    int RunHost(std::atomic_bool const& shutdown)
    {
#ifdef _WIN32
        _setmode(_fileno(stdin), _O_BINARY);
        _setmode(_fileno(stdout), _O_BINARY);
#else
        std::signal(SIGPIPE, SIG_IGN); // a closed stdout surfaces as a failed write
#endif
        Output output(stdout);
        std::atomic_bool cancel{}, busy{}, finished{};
        std::thread worker, opener; // opener: the file manager may stay alive, so never wait for it on the receive loop
        std::mutex folderMutex;
        std::string lastFolder; // folder of the latest completed download: the only folder a client can ask to open

        auto runJob = [&](Options const& options, std::optional<std::string> id, bool inlineJob)
        {
            HostSink sink(output, id, [&busy, inlineJob] { if (!inlineJob) busy = false; },
                [&](std::string const& path)
                {
                    std::lock_guard<std::mutex> lock(folderMutex);
                    lastFolder = WideToUtf8(std::filesystem::path(Utf8ToWide(path)).parent_path().wstring());
                });
            Engine engine(sink, cancel);
            auto report = [&sink](char const* code, char const* message)
            {
                try { sink.On(ErrorEvent{ code, message }); } catch (...) {} // a worker thread must never throw
            };
            try
            {
                switch (options.command)
                {
                case Command::Doctor: engine.Doctor(options); break;
                case Command::Probe: engine.Probe(options); break;
                default: engine.Download(options); break;
                }
            }
            catch (std::exception const& error) { report(cancel ? "cancelled" : "processing_failed", error.what()); }
            catch (...) { report("processing_failed", "Une erreur inattendue est survenue"); }
            if (inlineJob) return;
            busy = false;
            if (output.Failed()) std::_Exit(1); // stdout is gone and the job has been cancelled and cleaned up
        };

        // SIGINT/SIGTERM: cancel the running job, then leave (the reader thread may be blocked on stdin).
        std::thread watcher([&]
        {
            while (!finished)
            {
                if (shutdown)
                {
                    for (int i = 0; i < 500 && busy; ++i)
                    {
                        cancel = true;
                        std::this_thread::sleep_for(std::chrono::milliseconds(20));
                    }
                    std::_Exit(0);
                }
                std::this_thread::sleep_for(std::chrono::milliseconds(20));
            }
        });

        // Returns false when the host must stop (EOF or broken stdout).
        auto handleNext = [&]() -> bool
        {
            std::string body;
            auto read = ReadMessage(stdin, body);
            if (read == ReadResult::Eof) return false;
            if (read == ReadResult::TooLarge)
            {
                output.Send(ErrorJson("message_too_large", "Le message dépasse 4 Mio."), std::nullopt);
                return !output.Failed();
            }

            auto request = ParseJson(body);
            auto const* typeField = request ? request->Get("type") : nullptr;
            if (!typeField || typeField->type != Json::Type::String)
            {
                output.Send(ErrorJson("invalid_message", "Message JSON invalide ou sans type."), std::nullopt);
                return !output.Failed();
            }
            std::optional<std::string> id; // valid UTF-8 guaranteed by the parser; JsonEscape handles the rest
            if (auto const* idField = request->Get("id"); idField && idField->type == Json::Type::String) id = idField->string;
            auto const& type = typeField->string;

            if (type == "cancel")
            {
                if (busy) cancel = true;
                return true;
            }
            if (type == "openFolder")
            {
                std::string folder;
                { std::lock_guard<std::mutex> lock(folderMutex); folder = lastFolder; }
                if (folder.empty()) output.Send(ErrorJson("no_folder", "Aucun dossier de téléchargement à ouvrir."), id);
                else
                {
                    if (opener.joinable()) opener.join();
                    opener = std::thread([&output, folder, id]
                    {
                        if (OpenFolder(folder)) output.Send("{\"type\":\"opened\"}", id);
                        else output.Send(ErrorJson("open_failed", "Impossible d'ouvrir le dossier."), id);
                    });
                }
                return !output.Failed();
            }
            if (type != "doctor" && type != "probe" && type != "download")
            {
                output.Send(ErrorJson("invalid_message", "Type de message inconnu : " + type), id);
                return !output.Failed();
            }

            std::vector<std::wstring> args;
            std::string error;
            std::optional<Options> options;
            if (BuildArguments(type, *request, args, error))
            {
                auto parsed = ParseArguments(args);
                options = std::move(parsed.options);
                if (!options) error = WideToUtf8(parsed.error);
            }
            if (!options)
            {
                output.Send(ErrorJson("invalid_arguments", error), id);
                return !output.Failed();
            }

            if (type == "doctor") { runJob(*options, id, true); return !output.Failed(); }
            if (busy)
            {
                output.Send(ErrorJson("busy", "Un traitement est déjà en cours."), id);
                return !output.Failed();
            }
            if (worker.joinable()) worker.join();
            cancel = false;
            busy = true;
            worker = std::thread(runJob, *options, id, false);
            return true;
        };

        for (bool more = true; more;)
        {
            try { more = handleNext(); }
            catch (...) // never let an exception escape unframed
            {
                try { output.Send(ErrorJson("processing_failed", "Une erreur inattendue est survenue"), std::nullopt); } catch (...) {}
                more = !output.Failed();
            }
        }

        if (busy) cancel = true;
        if (worker.joinable()) worker.join();
        if (opener.joinable()) opener.join();
        finished = true;
        watcher.join();
        return 0;
    }
}
