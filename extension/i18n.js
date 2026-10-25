"use strict";
// Small in-house message catalogue (no browser.i18n: the user can pick a language other than the browser's).
// French is the reference: it is the fallback for an unsupported browser language and for any missing key.
// Shared by content.js (browser) and test/lib.test.js (Node). Brand name and timecode examples are not translated.
(function (root) {
  const DEFAULT_LANGUAGE = "fr";
  const LANGUAGES = ["fr", "en"];

  const MESSAGES = {
    fr: {
      "app.name": "MediaDownloader",
      "button.download": "Télécharger",
      "main.title": "Télécharger la vidéo",
      "settings.title": "Réglages",
      "action.close": "Fermer",
      "action.back": "Retour",
      "action.save": "Enregistrer",
      "action.download": "Télécharger",
      "action.cancel": "Annuler",
      "action.openFolder": "Ouvrir le dossier",

      "video.analyzing": "Analyse de la vidéo…",
      "video.word": "Vidéo",

      "field.quality": "Qualité",
      "field.name": "Nom du fichier",
      "field.namePlaceholder": "Titre de la vidéo",
      "field.maxSize": "Taille maximale (Mo, {max} max, facultatif)",
      "field.optional": "Facultatif",
      "field.trim": "Découper la vidéo",
      "field.start": "Début",
      "field.end": "Fin",
      "field.startAria": "Début, heures minutes secondes",
      "field.endAria": "Fin, heures minutes secondes",
      "unit.mb": "Mo",
      "quality.best": "Meilleure qualité",

      "status.ready": "Prêt à télécharger",
      "status.running": "En cours…",
      "status.interrupted": "Interrompu",
      "status.done": "Terminé",

      "phase.inspection": "Inspection",
      "phase.download": "Téléchargement",
      "phase.merge": "Assemblage",
      "phase.encode": "Encodage",
      "phase.encodePass": "Encodage (passe {pass}/2)",
      "phase.working": "Traitement",
      "progress.withPercent": "{phase}… {percent} %",
      "progress.noPercent": "{phase}…",

      "settings.dir": "Dossier de téléchargement",
      "settings.dirPlaceholder": "Dossier Vidéos par défaut",
      "settings.dirHint": "Par défaut : dossier Vidéos.",
      "settings.browse": "Parcourir…",
      "settings.picking": "Sélection…",
      "settings.pickingHint": "Sélection du dossier en cours…",
      "settings.theme": "Thème",
      "settings.themeLight": "Clair",
      "settings.themeDark": "Sombre",
      "settings.button": "Affichage du bouton",
      "settings.buttonPage": "Sur la page",
      "settings.buttonIcon": "Icône de la barre uniquement",
      "settings.language": "Langue",
      "settings.languageAuto": "Automatique (langue du navigateur)",
      "settings.lowResources": "Optimiser l'application (économie de ressources)",
      "settings.lowResourcesHint": "FFmpeg tourne en priorité basse avec 2 threads, les animations sont réduites et rien ne s'exécute en arrière-plan quand aucun téléchargement n'est en cours.",
      "settings.saveFailed": "Impossible d'enregistrer les réglages.",
      "lang.fr": "Français",
      "lang.en": "English",

      "notice.dirFallback": "Le dossier choisi est inutilisable : la vidéo a été enregistrée dans {dir}.",
      "error.generic": "Une erreur est survenue.",
      "error.timeInvalid": "Temps invalide : utilisez des secondes ou mm:ss.",
      "error.rangeTogether": "Le début et la fin doivent être fournis ensemble.",
      "error.rangeOrder": "La fin doit être strictement supérieure au début.",
      "error.rangeRequired": "Renseignez le début et la fin du découpage.",
      "error.sizeRange": "La taille maximale doit être comprise entre 0 et {max} Mo.",
      "error.absolutePath": "Saisissez un chemin absolu, par exemple C:\\Users\\Moi\\Videos.",
      "error.busy": "Un téléchargement est déjà en cours.",
      "error.cancelled": "Téléchargement annulé.",
      "error.invalid_arguments": "Paramètres invalides.",
      "error.host_disconnected": "L'hôte MediaDownloader est introuvable. Lancez « MediaDownloader.Cli install-host ».",
      "error.invalid_message": "L'hôte MediaDownloader installé est trop ancien : mettez à jour MediaDownloader.Cli puis relancez « install-host ».",
      "error.no_folder": "Aucun dossier à ouvrir.",
      "error.open_failed": "Impossible d'ouvrir le dossier.",
      "error.pick_failed": "Impossible d'ouvrir le sélecteur de dossier. Saisissez le chemin à la main.",
      "error.processing_failed": "Le téléchargement a échoué.",
      "error.download_failed": "Le téléchargement a échoué.",
      "error.probe_failed": "Impossible d'analyser cette vidéo.",
      "error.invalid_output_directory": "Le dossier de téléchargement est inutilisable. Vérifiez-le dans les réglages.",
      "error.tool_missing": "Un outil requis (yt-dlp ou FFmpeg) est introuvable.",
      "error.size_unreachable": "La durée est trop importante pour la taille demandée.",
      "error.size_exceeded": "Le fichier encodé dépasse encore la taille maximale demandée.",
      "error.message_too_large": "La réponse de l'hôte MediaDownloader est trop volumineuse.",
    },
    en: {
      "app.name": "MediaDownloader",
      "button.download": "Download",
      "main.title": "Download the video",
      "settings.title": "Settings",
      "action.close": "Close",
      "action.back": "Back",
      "action.save": "Save",
      "action.download": "Download",
      "action.cancel": "Cancel",
      "action.openFolder": "Open folder",

      "video.analyzing": "Analyzing the video…",
      "video.word": "Video",

      "field.quality": "Quality",
      "field.name": "File name",
      "field.namePlaceholder": "Video title",
      "field.maxSize": "Maximum size (MB, {max} max, optional)",
      "field.optional": "Optional",
      "field.trim": "Trim the video",
      "field.start": "Start",
      "field.end": "End",
      "field.startAria": "Start, hours minutes seconds",
      "field.endAria": "End, hours minutes seconds",
      "unit.mb": "MB",
      "quality.best": "Best quality",

      "status.ready": "Ready to download",
      "status.running": "In progress…",
      "status.interrupted": "Interrupted",
      "status.done": "Done",

      "phase.inspection": "Inspecting",
      "phase.download": "Downloading",
      "phase.merge": "Merging",
      "phase.encode": "Encoding",
      "phase.encodePass": "Encoding (pass {pass}/2)",
      "phase.working": "Processing",
      "progress.withPercent": "{phase}… {percent}%",
      "progress.noPercent": "{phase}…",

      "settings.dir": "Download folder",
      "settings.dirPlaceholder": "Default Videos folder",
      "settings.dirHint": "Default: Videos folder.",
      "settings.browse": "Browse…",
      "settings.picking": "Selecting…",
      "settings.pickingHint": "Choosing the folder…",
      "settings.theme": "Theme",
      "settings.themeLight": "Light",
      "settings.themeDark": "Dark",
      "settings.button": "Button display",
      "settings.buttonPage": "On the page",
      "settings.buttonIcon": "Toolbar icon only",
      "settings.language": "Language",
      "settings.languageAuto": "Automatic (browser language)",
      "settings.lowResources": "Optimize the application (save resources)",
      "settings.lowResourcesHint": "FFmpeg runs at low priority with 2 threads, animations are reduced and nothing runs in the background while no download is in progress.",
      "settings.saveFailed": "Could not save the settings.",
      "lang.fr": "Français",
      "lang.en": "English",

      "notice.dirFallback": "The chosen folder is unusable: the video was saved in {dir}.",
      "error.generic": "An error occurred.",
      "error.timeInvalid": "Invalid time: use seconds or mm:ss.",
      "error.rangeTogether": "Start and end must be provided together.",
      "error.rangeOrder": "The end must be strictly greater than the start.",
      "error.rangeRequired": "Enter both the start and the end of the trim.",
      "error.sizeRange": "The maximum size must be between 0 and {max} MB.",
      "error.absolutePath": "Enter an absolute path, for example C:\\Users\\Me\\Videos.",
      "error.busy": "A download is already in progress.",
      "error.cancelled": "Download cancelled.",
      "error.invalid_arguments": "Invalid parameters.",
      "error.host_disconnected": "The MediaDownloader host cannot be found. Run \"MediaDownloader.Cli install-host\".",
      "error.invalid_message": "The installed MediaDownloader host is too old: update MediaDownloader.Cli, then run \"install-host\" again.",
      "error.no_folder": "No folder to open.",
      "error.open_failed": "Could not open the folder.",
      "error.pick_failed": "Could not open the folder picker. Type the path by hand.",
      "error.processing_failed": "The download failed.",
      "error.download_failed": "The download failed.",
      "error.probe_failed": "Could not analyze this video.",
      "error.invalid_output_directory": "The download folder is unusable. Check it in the settings.",
      "error.tool_missing": "A required tool (yt-dlp or FFmpeg) cannot be found.",
      "error.size_unreachable": "The video is too long for the requested size.",
      "error.size_exceeded": "The encoded file is still larger than the requested maximum size.",
      "error.message_too_large": "The MediaDownloader host's response is too large.",
    },
  };

  // setting: "auto" or a language code; browserLanguages: navigator.languages-like list ("en-US", "fr"...).
  // An explicit supported choice wins; otherwise the first supported browser language; otherwise French.
  function resolveLanguage(setting, browserLanguages) {
    const wanted = String(setting ?? "auto").toLowerCase();
    if (LANGUAGES.includes(wanted)) return wanted;
    const list = Array.isArray(browserLanguages) ? browserLanguages : [browserLanguages];
    for (const tag of list) {
      const primary = String(tag ?? "").toLowerCase().split(/[-_]/)[0];
      if (LANGUAGES.includes(primary)) return primary;
    }
    return DEFAULT_LANGUAGE;
  }

  function hasKey(key) {
    return Object.prototype.hasOwnProperty.call(MESSAGES[DEFAULT_LANGUAGE], key);
  }

  // Missing key in the language -> French; missing everywhere -> the key itself (never throws).
  function translate(language, key, params) {
    const table = MESSAGES[language] || MESSAGES[DEFAULT_LANGUAGE];
    let text = Object.prototype.hasOwnProperty.call(table, key) ? table[key] : MESSAGES[DEFAULT_LANGUAGE][key];
    if (typeof text !== "string") text = String(key);
    return text.replace(/\{(\w+)\}/g, (match, name) => (params && name in params ? String(params[name]) : match));
  }

  const api = { DEFAULT_LANGUAGE, LANGUAGES, MESSAGES, resolveLanguage, hasKey, translate };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MDI18n = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
