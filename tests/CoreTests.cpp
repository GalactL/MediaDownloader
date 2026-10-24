#include "Core.h"
#include "TemporaryFiles.h"

#include <chrono>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <iostream>

using namespace media_downloader;

namespace
{
    int failures{};

    void Check(bool condition, char const* message)
    {
        if (!condition)
        {
            std::cerr << "ECHEC: " << message << '\n';
            ++failures;
        }
    }
}

int main()
{
    Check(IsSupportedUrl(L"https://www.youtube.com/watch?v=test"), "HTTPS doit être accepté");
    Check(IsSupportedUrl(L"HTTP://example.test/video"), "HTTP est insensible à la casse");
    Check(!IsSupportedUrl(L"file:///C:/secret.mp4"), "file:// doit être refusé");
    Check(!IsSupportedUrl(L"javascript:alert(1)"), "javascript: doit être refusé");
    Check(IsYouTubeUrl(L"https://www.youtube.com/watch?v=test"), "youtube.com détecté");
    Check(IsYouTubeUrl(L"https://youtu.be/test"), "youtu.be détecté");
    Check(!IsYouTubeUrl(L"https://youtube.com.example.test/video"), "faux domaine YouTube refusé");

    Check(BuildFormatSelector(L"best") == L"bestvideo+bestaudio/best", "sélecteur best");
    Check(BuildFormatSelector(L"2160") == L"bestvideo[height<=2160]+bestaudio/best[height<=2160]/best", "sélecteur 4K");
    Check(BuildFormatSelector(L"1440") == L"bestvideo[height<=1440]+bestaudio/best[height<=1440]/best", "sélecteur 2K");
    Check(BuildFormatSelector(L"1080") == L"bestvideo[height<=1080]+bestaudio/best[height<=1080]/best", "sélecteur 1080p avec repli direct");
    Check(SanitizeFileName(L" Mon titre: test? ") == L"Mon titre_ test_", "nettoyage du titre Windows");
    Check(SanitizeFileName(L"CON") == L"_CON", "nom Windows réservé");
    Check(SanitizeFileName(L"... ") == L"video", "titre vide après nettoyage");

    auto plan = CalculateEncodePlan(60.0, 10.0);
    Check(plan.has_value(), "un encodage de 60 secondes vers 10 Mo doit être possible");
    if (plan)
    {
        Check(plan->targetBytes < 10ull * 1024ull * 1024ull, "la cible réserve une marge conteneur");
        Check(plan->audioKbps == 128, "débit audio standard");
        Check(plan->videoKbps > 1000, "débit vidéo cohérent");
    }
    Check(!CalculateEncodePlan(7200.0, 1.0).has_value(), "une cible irréaliste doit être refusée");
    Check(!CalculateEncodePlan(0.0, 10.0).has_value(), "une durée nulle doit être refusée");

    auto parsed = ParseArguments({ L"download", L"--url", L"https://example.test/v", L"--quality", L"720", L"--max-size-mb", L"10" });
    Check(parsed.options.has_value(), "arguments de téléchargement valides");
    if (parsed.options)
    {
        Check(parsed.options->command == Command::Download, "commande download");
        Check(parsed.options->quality == L"720", "qualité analysée");
        Check(parsed.options->maxSizeMb == 10.0, "taille analysée");
        Check(parsed.options->cookiesFromBrowser == L"auto", "Firefox automatique par défaut");
    }
    Check(!ParseArguments({ L"download", L"--url", L"file:///x" }).options.has_value(), "URL locale refusée");
    Check(!ParseArguments({ L"download", L"--quality", L"4k" }).options.has_value(), "qualité invalide refusée");
    auto authenticated = ParseArguments({ L"download", L"--url", L"https://youtube.test/v", L"--title", L"Titre", L"--cookies-from-browser", L"edge" });
    Check(authenticated.options && authenticated.options->title == L"Titre", "titre personnalisé analysé");
    Check(authenticated.options && authenticated.options->cookiesFromBrowser == L"edge", "navigateur analysé");
    Check(ParseArguments({ L"download", L"--url", L"https://youtube.test/v", L"--cookies-from-browser", L"auto" }).options.has_value(), "authentification automatique acceptée");
    Check(!ParseArguments({ L"download", L"--url", L"https://youtube.test/v", L"--cookies-from-browser", L"inconnu" }).options.has_value(), "navigateur inconnu refusé");

    auto rangeFromZero = ParseArguments({ L"download", L"--url", L"https://example.test/v", L"--start-time", L"0", L"--end-time", L"30" });
    Check(rangeFromZero.options && rangeFromZero.options->startTimeSeconds == 0.0 && rangeFromZero.options->endTimeSeconds == 30.0,
        "plage 0 à 30 valide");
    auto decimalRange = ParseArguments({ L"download", L"--url", L"https://example.test/v", L"--start-time", L"30", L"--end-time", L"95.5" });
    Check(decimalRange.options && decimalRange.options->startTimeSeconds == 30.0 && decimalRange.options->endTimeSeconds == 95.5,
        "plage décimale 30 à 95.5 valide");
    Check(BuildDownloadSection(30.0, 95.5) == L"*30-95.5", "syntaxe de plage yt-dlp");
    Check(!ParseArguments({ L"download", L"--url", L"https://example.test/v", L"--end-time", L"30" }).options,
        "début absent invalide");
    Check(!ParseArguments({ L"download", L"--url", L"https://example.test/v", L"--start-time", L"30" }).options,
        "fin absente invalide");
    Check(!ParseArguments({ L"download", L"--url", L"https://example.test/v", L"--start-time", L"-1", L"--end-time", L"30" }).options,
        "début négatif invalide");
    Check(!ParseArguments({ L"download", L"--url", L"https://example.test/v", L"--start-time", L"30", L"--end-time", L"30" }).options,
        "fin égale au début invalide");
    Check(!ParseArguments({ L"download", L"--url", L"https://example.test/v", L"--start-time", L"30", L"--end-time", L"20" }).options,
        "fin inférieure au début invalide");
    for (auto invalid : { L"NaN", L"inf", L"texte" })
    {
        Check(!ParseArguments({ L"download", L"--url", L"https://example.test/v", L"--start-time", invalid, L"--end-time", L"30" }).options,
            "début non fini ou textuel invalide");
        Check(!ParseArguments({ L"download", L"--url", L"https://example.test/v", L"--start-time", L"0", L"--end-time", invalid }).options,
            "fin non finie ou textuelle invalide");
    }
    auto normalDownload = ParseArguments({ L"download", L"--url", L"https://example.test/v", L"--quality", L"1080" });
    Check(normalDownload.options && !normalDownload.options->startTimeSeconds && !normalDownload.options->endTimeSeconds,
        "téléchargement normal sans timecode inchangé");
    auto compatibleRange = ParseArguments({
        L"download", L"--url", L"https://example.test/v", L"--start-time", L"30", L"--end-time", L"95.5",
        L"--quality", L"720", L"--format", L"mp4", L"--title", L"Extrait", L"--max-size-mb", L"10",
        L"--cookies-from-browser", L"firefox", L"--output", L"output", L"--overwrite",
        L"--yt-dlp", L"yt-dlp", L"--ffmpeg", L"ffmpeg", L"--ffprobe", L"ffprobe"
    });
    Check(compatibleRange.options.has_value(), "plage compatible avec toutes les options existantes");

    Check(JsonEscape("a\"b\\c\n") == "a\\\"b\\\\c\\n", "échappement JSON");
    Check(SummarizeDownloadFailure("ERROR: Could not copy Chrome cookie database") ==
        "Impossible de lire les cookies du navigateur. Fermez complètement le navigateur sélectionné, puis réessayez.", "diagnostic navigateur ouvert");
    Check(SummarizeDownloadFailure("ERROR: Sign in to confirm your age") ==
        "YouTube n'a pas reconnu une session autorisée pour cette vidéo. Vérifiez le navigateur sélectionné et l'âge du compte.", "diagnostic restriction d'âge");
    Check(SummarizeDownloadFailure("ERROR: Failed to decrypt with DPAPI. See issue 10927") ==
        "Windows n'a pas pu déchiffrer les cookies de ce navigateur Chromium. Utilisez de préférence Firefox connecté à YouTube, puis fermez-le avant de réessayer.", "diagnostic DPAPI Chromium");
    Check(SummarizeDownloadFailure("noise\nERROR: panne précise\n") == "panne précise", "repli sur la dernière erreur yt-dlp");
    Check(SummarizeDownloadFailure("WARNING: n challenge solving failed\nERROR: The page needs to be reloaded") ==
        "Le challenge JavaScript de YouTube n'a pas pu être résolu. Vérifiez qu'un runtime Node ou Deno récent est disponible.", "diagnostic challenge JavaScript");

    std::uint64_t temporaryPid{};
    Check(TryParseTemporaryDirectoryName(L".mediadownloader-42-123456", temporaryPid) && temporaryPid == 42,
        "nom de dossier temporaire reconnu");
    Check(!TryParseTemporaryDirectoryName(L".mediadownloader-important", temporaryPid), "nom utilisateur similaire ignoré");
    Check(!TryParseTemporaryDirectoryName(L".mediadownloader-42-123-extra", temporaryPid), "suffixe temporaire invalide ignoré");

    auto testRoot = std::filesystem::temp_directory_path() /
        ("mediadownloader-cleanup-tests-" + std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()));
    auto orphan = testRoot / ".mediadownloader-101-1";
    auto active = testRoot / ".mediadownloader-202-2";
    auto unrelated = testRoot / ".mediadownloader-not-ours";
    std::filesystem::create_directories(orphan);
    std::filesystem::create_directories(active);
    std::filesystem::create_directories(unrelated);
    std::ofstream(orphan / "partial.file") << "test";
    auto cleanup = CleanupOrphanedTemporaryDirectories(testRoot, [](std::uint64_t pid) { return pid == 202; });
    Check(!std::filesystem::exists(orphan), "dossier orphelin supprimé");
    Check(std::filesystem::exists(active), "dossier d'une instance active conservé");
    Check(std::filesystem::exists(unrelated), "dossier non conforme conservé");
    Check(cleanup.removed.size() == 1 && cleanup.failures.empty(), "résultat de nettoyage cohérent");
    std::error_code cleanupError;
    std::filesystem::remove_all(testRoot, cleanupError);

    Check(IsNativeHostLaunch({ L"C:\\x\\media_downloader.json", L"mediadownloader@localhost" }), "lancement Firefox : manifeste + id");
    Check(IsNativeHostLaunch({ L"/home/u/.mozilla/native-messaging-hosts/media_downloader.json" }), "lancement Firefox : manifeste seul");
    Check(IsNativeHostLaunch({ L"mediadownloader@localhost" }), "lancement Firefox : id seul");
    Check(IsNativeHostLaunch({ L"{12345678-1234-1234-1234-123456789abc}" }), "lancement Firefox : id uuid");
    Check(!IsNativeHostLaunch({}), "aucun argument : pas l'hôte");
    Check(!IsNativeHostLaunch({ L"download", L"--url", L"https://example.test/a@b.json" }), "download : pas l'hôte");
    Check(!IsNativeHostLaunch({ L"host" }) && !IsNativeHostLaunch({ L"doctor" }) && !IsNativeHostLaunch({ L"--help" }), "commandes connues : pas l'hôte");
    Check(!IsNativeHostLaunch({ L"n'importe-quoi" }), "mot inconnu : pas l'hôte");

    {
        auto manifest = BuildNativeManifest("C:\\Program Files\\MD\\MediaDownloader.Cli.exe", "mediadownloader@localhost");
        Check(manifest.find("\"name\": \"media_downloader\"") != std::string::npos, "manifeste : nom");
        Check(manifest.find("\"path\": \"C:\\\\Program Files\\\\MD\\\\MediaDownloader.Cli.exe\"") != std::string::npos, "manifeste : antislashs Windows échappés");
        Check(manifest.find("\"type\": \"stdio\"") != std::string::npos, "manifeste : stdio");
        Check(manifest.find("\"allowed_extensions\": [\"mediadownloader@localhost\"]") != std::string::npos, "manifeste : allowed_extensions");
        Check(BuildNativeManifest("/a\"b", "x@y").find("/a\\\"b") != std::string::npos, "manifeste : guillemet échappé");
        std::filesystem::path home{ "/home/u" }, exeDir{ "/opt/md" };
        Check(NativeManifestPath(HostPlatform::Linux, home, exeDir) == home / ".mozilla/native-messaging-hosts/media_downloader.json", "chemin manifeste Linux");
        Check(NativeManifestPath(HostPlatform::MacOS, home, exeDir) == home / "Library/Application Support/Mozilla/NativeMessagingHosts/media_downloader.json", "chemin manifeste macOS");
        Check(NativeManifestPath(HostPlatform::Windows, home, exeDir) == exeDir / "native-host/media_downloader.json", "chemin manifeste Windows");
        auto parsed = ParseArguments({ L"install-host" });
        Check(parsed.options && parsed.options->command == Command::InstallHost, "install-host reconnu");
        Check(!ParseArguments({ L"install-host", L"--x" }).options, "install-host refuse les arguments");
    }

    if (failures == 0) std::cout << "Tous les tests sont passes.\n";
    return failures == 0 ? 0 : 1;
}
