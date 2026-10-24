#pragma once

#include "Engine.h"

#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace media_downloader
{
    // One JSON object (no trailing newline) in the HUB protocol format, shared by the CLI and the host.
    std::string SerializeEvent(Event const& event);

    // Minimal JSON value; numbers are doubles, object keys keep their order (last duplicate wins on Get).
    struct Json
    {
        enum class Type { Null, Bool, Number, String, Array, Object };
        Type type{ Type::Null };
        bool boolean{};
        double number{};
        std::string string;
        std::vector<Json> array;
        std::vector<std::pair<std::string, Json>> object;

        Json const* Get(std::string_view key) const;
    };

    // Strict RFC 8259 parse of a whole document (nesting limited to 64); nullopt on any error.
    std::optional<Json> ParseJson(std::string_view text);

    // Firefox native messaging host on stdin/stdout (4-byte native-endian length + UTF-8 JSON).
    // Returns the process exit code (0 on stdin EOF).
    int RunHost();
}
