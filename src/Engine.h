#pragma once

#include "Core.h"

#include <atomic>
#include <cstdint>
#include <filesystem>
#include <optional>
#include <string>
#include <variant>

namespace media_downloader
{
    // All strings are UTF-8. Events mirror the CLI protocol (docs/CLI_PROTOCOL.md).
    struct StartedEvent { std::string outputDirectory; };
    struct LogEvent { std::string level; std::string message; };
    struct ProgressEvent { std::string stage; double percent{}; int pass{}; }; // pass 0 = absent
    struct EncodingPlanEvent { double durationSeconds{}; std::uint32_t videoKbps{}; std::uint32_t audioKbps{}; };
    struct CompletedEvent { std::string path; std::uint64_t bytes{}; };
    struct ErrorEvent { std::string code; std::string message; };
    struct DoctorTool { bool found{}; std::string path; };
    struct DoctorEvent { DoctorTool ytDlp, ffmpeg, ffprobe, javascriptRuntime; };
    struct ProbeEvent { std::string json; }; // raw yt-dlp --dump-single-json object

    using Event = std::variant<StartedEvent, LogEvent, ProgressEvent, EncodingPlanEvent,
        CompletedEvent, ErrorEvent, DoctorEvent, ProbeEvent>;

    // May be called from a process-reader thread; implementations must be thread-safe.
    class EventSink
    {
    public:
        virtual ~EventSink() = default;
        virtual void On(Event const& event) = 0;
    };

    // Each method returns the CLI exit code (0 ok, 3 missing tool, 4 failure/cancel).
    // Download/Probe may throw std::exception for unexpected failures (callers map to "processing_failed").
    class Engine
    {
    public:
        Engine(EventSink& sink, std::atomic_bool const& cancel) : sink_(sink), cancel_(cancel) {}
        int Doctor(Options const& options);
        int Probe(Options const& options);
        int Download(Options const& options);
        // Writes the Firefox native-messaging manifest (and the registry key on Windows). Throws on failure.
        int InstallHost();

    private:
        EventSink& sink_;
        std::atomic_bool const& cancel_;
    };
}
