#include "Core.h"

#include <cmath>
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

    if (failures == 0) std::cout << "Tous les tests sont passes.\n";
    return failures == 0 ? 0 : 1;
}
