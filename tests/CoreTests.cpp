#include "Core.h"
#include "TemporaryFiles.h"

#include <chrono>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <iostream>
#ifndef _WIN32
#include <unistd.h>
#endif

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
    Check(IsTwitterUrl(L"https://x.com/u/status/1"), "x.com détecté");
    Check(IsTwitterUrl(L"https://twitter.com/u/status/1"), "twitter.com détecté");
    Check(IsTwitterUrl(L"https://www.x.com/u/status/1") && IsTwitterUrl(L"https://mobile.twitter.com/u/status/1"), "sous-domaines X détectés");
    Check(!IsTwitterUrl(L"https://x.com.evil.test/u/status/1") && !IsTwitterUrl(L"https://evilx.com/u/status/1"), "faux domaines X refusés");

    Check(BuildFormatSelector(L"best") == L"bestvideo+bestaudio/best", "sélecteur best");
    Check(BuildFormatSelector(L"2160") == L"bestvideo[height<=2160]+bestaudio/best[height<=2160]/best", "sélecteur 4K");
    Check(BuildFormatSelector(L"1440") == L"bestvideo[height<=1440]+bestaudio/best[height<=1440]/best", "sélecteur 2K");
    Check(BuildFormatSelector(L"1080") == L"bestvideo[height<=1080]+bestaudio/best[height<=1080]/best", "sélecteur 1080p avec repli direct");
    Check(SanitizeFileName(L" Mon titre: test? ") == L"Mon titre_ test_", "nettoyage du titre Windows");
    {
        auto base = std::filesystem::temp_directory_path() / (L"md-out-" + std::to_wstring(std::chrono::steady_clock::now().time_since_epoch().count()));
        std::filesystem::path resolved;
        Check(EnsureOutputDirectory(base / L"a" / L"b", resolved) && std::filesystem::is_directory(base / L"a" / L"b"), "dossier de sortie imbriqué créé");
        { std::ofstream(base / L"f.txt") << "x"; }
        Check(!EnsureOutputDirectory(base / L"f.txt", resolved), "fichier refusé comme dossier de sortie");
        Check(!EnsureOutputDirectory(base / L"f.txt" / L"sub", resolved), "dossier sous un fichier refusé");
        {
            bool leftover = false;
            for (auto const& entry : std::filesystem::directory_iterator(base / L"a" / L"b"))
                leftover = leftover || entry.path().filename().wstring().starts_with(L".mediadownloader-probe-");
            Check(!leftover, "le fichier témoin d'écriture est supprimé");
        }
#ifndef _WIN32
        if (geteuid() != 0)
        {
            auto readOnly = base / L"ro";
            std::filesystem::create_directories(readOnly);
            std::filesystem::permissions(readOnly, std::filesystem::perms::owner_read | std::filesystem::perms::owner_exec);
            Check(!EnsureOutputDirectory(readOnly, resolved), "dossier en lecture seule refusé");
            Check(!EnsureOutputDirectory(readOnly / L"sub", resolved), "création sous un dossier en lecture seule refusée");
            std::filesystem::permissions(readOnly, std::filesystem::perms::owner_all);
        }
#endif
        std::error_code ignored;
        std::filesystem::remove_all(base, ignored);
    }
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

    Check(ParseFfmpegDuration("  Duration: 01:02:03.50, start: 0.000000, bitrate: 800 kb/s") == 3723.5, "durée ffmpeg HH:MM:SS.xx");
    Check(!ParseFfmpegDuration("  Duration: N/A, bitrate: N/A").has_value(), "durée ffmpeg N/A refusée");
    Check(!ParseFfmpegDuration("  Duration: 00:00:00.00, start: 0").has_value(), "durée ffmpeg nulle refusée");
    Check(!ParseFfmpegDuration("pas de durée").has_value(), "durée ffmpeg absente");

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

    // --low-resources: optional flag, off by default.
    {
        auto plain = ParseArguments({ L"download", L"--url", L"https://example.test/v" });
        auto low = ParseArguments({ L"download", L"--url", L"https://example.test/v", L"--low-resources" });
        Check(plain.options && !plain.options->lowResources, "--low-resources est désactivé par défaut");
        Check(low.options && low.options->lowResources, "--low-resources est reconnu");
    }

    // FFmpeg arguments: unchanged without low resources; "-threads 2" only with it.
    {
        std::filesystem::path source{ "/t/in.mp4" }, destination{ "/t/out.mp4" }, passLog{ "/t/pass" };
        auto pass1 = BuildEncodeArguments(source, destination, passLog, 800, 96, L"best", 1, false);
        std::vector<std::wstring> expected1{ L"-y", L"-i", L"/t/in.mp4", L"-map", L"0:v:0", L"-c:v", L"libx264", L"-preset", L"medium",
            L"-b:v", L"800k", L"-pass", L"1", L"-passlogfile", L"/t/pass", L"-progress", L"pipe:1", L"-nostats", L"-an", L"-f", L"null",
#ifdef _WIN32
            L"NUL"
#else
            L"/dev/null"
#endif
        };
        Check(pass1 == expected1, "arguments FFmpeg passe 1 inchangés sans économie de ressources");
        auto pass2 = BuildEncodeArguments(source, destination, passLog, 800, 96, L"720", 2, false);
        std::vector<std::wstring> expected2{ L"-y", L"-i", L"/t/in.mp4", L"-map", L"0:v:0", L"-vf", L"scale=-2:min(ih\\,720)", L"-c:v", L"libx264",
            L"-preset", L"medium", L"-b:v", L"800k", L"-pass", L"2", L"-passlogfile", L"/t/pass", L"-progress", L"pipe:1", L"-nostats",
            L"-map", L"0:a:0?", L"-c:a", L"aac", L"-b:a", L"96k", L"-movflags", L"+faststart", L"/t/out.mp4" };
        Check(pass2 == expected2, "arguments FFmpeg passe 2 (hauteur 720) inchangés sans économie de ressources");
        auto lowPass1 = BuildEncodeArguments(source, destination, passLog, 800, 96, L"best", 1, true);
        std::vector<std::wstring> withThreads = pass1;
        withThreads.insert(withThreads.begin() + 15, { L"-threads", L"2" });
        Check(lowPass1 == withThreads, "économie de ressources : seul -threads 2 est ajouté");
    }

    // yt-dlp progress lines produced by the engine's --progress-template (frozen contract).
    {
        auto line = ParseDownloadProgressLine("__MD_PROGRESS__:downloading|1024|2048|NA|NA|NA|137");
        Check(line && line->status == "downloading" && line->downloadedBytes == 1024.0 && line->totalBytes == 2048.0
            && !line->fragmentIndex && !line->fragmentCount && line->formatId == "137", "ligne de progression yt-dlp analysée");
        auto estimate = ParseDownloadProgressLine("__MD_PROGRESS__:downloading|10.5|NA|400|NA|NA|NA");
        Check(estimate && estimate->totalBytes == 400.0 && estimate->formatId.empty(), "taille estimée utilisée à défaut de la taille exacte");
        auto fragments = ParseDownloadProgressLine("__MD_PROGRESS__:downloading|10|NA|NA|3|12|251");
        Check(fragments && fragments->fragmentIndex == 3.0 && fragments->fragmentCount == 12.0 && !fragments->totalBytes, "fragments analysés");
        Check(!ParseDownloadProgressLine("[download]  42.0% of 1.00MiB"), "ligne yt-dlp classique ignorée");
        Check(!ParseDownloadProgressLine("__MD_PROGRESS__:downloading|1|2"), "ligne tronquée refusée");
        Check(!ParseDownloadProgressLine("__MD_PROGRESS__:|1|2|3|4|5|6"), "statut vide refusé");
        auto garbage = ParseDownloadProgressLine("__MD_PROGRESS__:downloading|abc|-5|NA|x|NA|18");
        Check(garbage && !garbage->downloadedBytes && !garbage->totalBytes && !garbage->fragmentIndex, "champs invalides ignorés");

        Check(ParsePostprocessorStart("__MD_POST__:started|Merger") == std::optional<std::string>("Merger"), "post-traitement démarré");
        Check(!ParsePostprocessorStart("__MD_POST__:finished|Merger"), "post-traitement terminé ignoré");
        Check(!ParsePostprocessorStart("[Merger] Merging formats"), "ligne Merger classique ignorée");

        // Video (0-85) then audio (85-100), monotonic, no percent without a size.
        DownloadProgressSmoother smoother;
        auto at = [&](char const* text) { return smoother.Update(*ParseDownloadProgressLine(text)); };
        Check(at("__MD_PROGRESS__:downloading|0|1000|NA|NA|NA|137") == 0.0, "lissage : début de la vidéo à 0");
        Check(at("__MD_PROGRESS__:downloading|500|1000|NA|NA|NA|137") == 42.5, "lissage : moitié de la vidéo");
        Check(at("__MD_PROGRESS__:finished|1000|1000|NA|NA|NA|137") == 85.0, "lissage : vidéo terminée");
        Check(at("__MD_PROGRESS__:downloading|0|100|NA|NA|NA|140") == 85.0, "lissage : le second flux ne fait pas reculer");
        Check(at("__MD_PROGRESS__:downloading|50|100|NA|NA|NA|140") == 92.5, "lissage : moitié de l'audio");
        Check(!at("__MD_PROGRESS__:downloading|50|NA|NA|NA|NA|140"), "lissage : pas de pourcentage sans taille");
        Check(at("__MD_PROGRESS__:finished|100|100|NA|NA|NA|140") == 100.0, "lissage : audio terminé = 100");
    }

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
        Check(NativeManifestPath(HostPlatform::Windows, home, exeDir) == exeDir / "native-host/media_downloader.json", "chemin manifeste Windows");
        auto installHost = ParseArguments({ L"install-host" });
        Check(installHost.options && installHost.options->command == Command::InstallHost, "install-host reconnu");
        Check(!ParseArguments({ L"install-host", L"--x" }).options, "install-host refuse les arguments");
        auto uninstallHost = ParseArguments({ L"uninstall-host" });
        Check(uninstallHost.options && uninstallHost.options->command == Command::UninstallHost, "uninstall-host reconnu");
        Check(!ParseArguments({ L"uninstall-host", L"--x" }).options, "uninstall-host refuse les arguments");
        auto update = ParseArguments({ L"update" });
        Check(update.options && update.options->command == Command::Update, "update reconnu");
        Check(!ParseArguments({ L"update", L"--x" }).options, "update refuse les arguments");
    }

    if (failures == 0) std::cout << "Tous les tests sont passes.\n";
    return failures == 0 ? 0 : 1;
}
