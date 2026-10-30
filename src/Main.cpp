#include "Core.h"
#include "Engine.h"
#include "Host.h"

#ifdef _WIN32
#include <windows.h>
#include <objbase.h>
#else
#include <csignal>
#endif

#include <algorithm>
#include <atomic>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <variant>
#include <mutex>
#include <string>
#include <type_traits>

using namespace media_downloader;

namespace
{
    std::atomic_bool g_cancelRequested{};
    std::mutex g_outputMutex;

#ifdef _WIN32
    BOOL WINAPI ConsoleHandler(DWORD event)
    {
        if (event == CTRL_C_EVENT || event == CTRL_BREAK_EVENT || event == CTRL_CLOSE_EVENT)
        {
            g_cancelRequested = true;
            return TRUE;
        }
        return FALSE;
    }
#else
    void ConsoleHandler(int) { g_cancelRequested = true; }
#endif

    void Emit(std::string const& json)
    {
        std::scoped_lock lock(g_outputMutex);
        std::cout << json << '\n' << std::flush;
    }

    void EmitError(std::string const& code, std::string const& message)
    {
        Emit("{\"type\":\"error\",\"code\":\"" + JsonEscape(code) + "\",\"message\":\"" + JsonEscape(message) + "\"}");
    }

    // Serializes engine events as one JSON object per line (CLI protocol, docs/CLI_PROTOCOL.md).
    class JsonSink : public EventSink
    {
    public:
        void On(Event const& event) override { Emit(SerializeEvent(event)); }
    };

    JsonSink g_sink;
    Engine g_engine{ g_sink, g_cancelRequested };

    void PrintHelp()
    {
        std::cout <<
            "MediaDownloader 0.4.1\n\n"
            "Usage:\n"
            "  MediaDownloader doctor [chemins des outils]\n"
            "  MediaDownloader probe --url URL\n"
            "  MediaDownloader download --url URL [options]\n"
            "  MediaDownloader host   Messagerie native Firefox (stdin/stdout)\n"
            "  MediaDownloader install-host   Enregistre l'hote natif pour Firefox\n"
            "  MediaDownloader uninstall-host   Retire l'hote natif de Firefox\n"
            "  MediaDownloader update   Met a jour yt-dlp (yt-dlp -U)\n\n"
            "Options:\n"
            "  --quality best|720|1080    Qualite ou hauteur maximale\n"
            "  --format mp4|mkv|webm      Conteneur final (mp4 par defaut)\n"
            "  --title TITRE               Nom personnalise du fichier final\n"
            "  --start-time SECONDES       Debut facultatif de la plage\n"
            "  --end-time SECONDES         Fin facultative de la plage\n"
            "  --max-size-mb N            Taille maximale, en Mio\n"
            "  --cookies-from-browser NOM Utiliser auto, Firefox, Edge, Chrome…\n"
            "  --output DOSSIER           Dossier cible (Videos par defaut)\n"
            "  --overwrite                Remplacer un fichier homonyme\n"
            "  --low-resources            FFmpeg en priorite basse, 2 threads\n"
            "  --yt-dlp CHEMIN            Chemin de yt-dlp.exe\n"
            "  --ffmpeg CHEMIN            Chemin de ffmpeg.exe\n"
            "  --ffprobe CHEMIN           Ignore (compatibilite)\n";
    }
}

#ifdef _WIN32
int wmain(int argc, wchar_t* argv[])
{
    SetConsoleOutputCP(CP_UTF8);
    SetConsoleCtrlHandler(ConsoleHandler, TRUE);
    CoInitializeEx(nullptr, COINIT_MULTITHREADED);

    std::vector<std::wstring> arguments;
    for (int index = 1; index < argc; ++index) arguments.emplace_back(argv[index]);
    if (IsNativeHostLaunch(arguments)) arguments = { L"host" };
    auto parsed = ParseArguments(arguments);
    if (!parsed.options)
    {
        EmitError("invalid_arguments", WideToUtf8(parsed.error));
        CoUninitialize();
        return 2;
    }

    int exitCode{};
    try
    {
        switch (parsed.options->command)
        {
        case Command::Help: PrintHelp(); break;
        case Command::Doctor: exitCode = g_engine.Doctor(*parsed.options); break;
        case Command::Probe: exitCode = g_engine.Probe(*parsed.options); break;
        case Command::Download: exitCode = g_engine.Download(*parsed.options); break;
        case Command::InstallHost: exitCode = g_engine.InstallHost(); break;
        case Command::UninstallHost: exitCode = g_engine.UninstallHost(); break;
        case Command::Update: exitCode = g_engine.Update(*parsed.options); break;
        case Command::Host: exitCode = RunHost(g_cancelRequested); break;
        }
    }
    catch (std::exception const& error)
    {
        EmitError(g_cancelRequested ? "cancelled" : "processing_failed", error.what());
        exitCode = 4;
    }
    catch (...)
    {
        EmitError("processing_failed", "Une erreur inattendue est survenue");
        exitCode = 4;
    }
    CoUninitialize();
    return exitCode;
}
#else
int main(int argc, char* argv[])
{
    std::signal(SIGINT, ConsoleHandler);
    std::signal(SIGTERM, ConsoleHandler);
    std::vector<std::wstring> arguments;
    for (int index = 1; index < argc; ++index) arguments.emplace_back(Utf8ToWide(argv[index]));
    if (IsNativeHostLaunch(arguments)) arguments = { L"host" };
    auto parsed = ParseArguments(arguments);
    if (!parsed.options)
    {
        EmitError("invalid_arguments", WideToUtf8(parsed.error));
        return 2;
    }
    try
    {
        switch (parsed.options->command)
        {
        case Command::Help: PrintHelp(); return 0;
        case Command::Doctor: return g_engine.Doctor(*parsed.options);
        case Command::Probe: return g_engine.Probe(*parsed.options);
        case Command::Download: return g_engine.Download(*parsed.options);
        case Command::InstallHost: return g_engine.InstallHost();
        case Command::UninstallHost: return g_engine.UninstallHost();
        case Command::Update: return g_engine.Update(*parsed.options);
        case Command::Host: return RunHost(g_cancelRequested);
        }
    }
    catch (std::exception const& error)
    {
        EmitError(g_cancelRequested ? "cancelled" : "processing_failed", error.what());
        return 4;
    }
    catch (...)
    {
        EmitError("processing_failed", "Une erreur inattendue est survenue");
        return 4;
    }
    return 0;
}
#endif
