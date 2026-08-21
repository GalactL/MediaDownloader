#include "ChildProcess.h"
#include "Core.h"

#include <windows.h>
#include <commctrl.h>
#include <dwmapi.h>
#include <shellapi.h>
#include <uxtheme.h>

#include <algorithm>
#include <atomic>
#include <filesystem>
#include <memory>
#include <optional>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

using namespace media_downloader;

namespace
{
    constexpr wchar_t WindowClass[] = L"MediaDownloaderWindow";
    constexpr UINT MessageProcessLine = WM_APP + 1;
    constexpr UINT MessageProcessComplete = WM_APP + 2;

    enum ControlId
    {
        UrlEdit = 100,
        TitleEdit,
        QualityCombo,
        FormatCombo,
        LimitCheck,
        SizeEdit,
        DiscordButton,
        DownloadButton,
        CancelButton,
        ProgressBar,
        LogEdit,
        StatusText
    };

    struct UiState
    {
        HWND window{};
        HWND url{};
        HWND title{};
        HWND quality{};
        HWND format{};
        HWND limit{};
        HWND size{};
        HWND discord{};
        HWND download{};
        HWND cancel{};
        HWND progress{};
        HWND log{};
        HWND status{};
        HFONT normalFont{};
        HFONT titleFont{};
        HBRUSH backgroundBrush{};
        HBRUSH fieldBrush{};
        std::thread worker;
        std::atomic_bool cancelRequested{};
        bool running{};
        bool receivedTerminalEvent{};
    } g_ui;

    constexpr COLORREF Background = RGB(11, 14, 18);
    constexpr COLORREF Field = RGB(21, 25, 32);
    constexpr COLORREF Text = RGB(238, 241, 246);
    constexpr COLORREF Muted = RGB(150, 159, 174);

    std::wstring GetText(HWND control)
    {
        auto length = GetWindowTextLengthW(control);
        std::wstring value(static_cast<size_t>(length) + 1, L'\0');
        GetWindowTextW(control, value.data(), length + 1);
        value.resize(static_cast<size_t>(length));
        return value;
    }

    std::filesystem::path ExecutableDirectory()
    {
        std::wstring buffer(32768, L'\0');
        auto length = GetModuleFileNameW(nullptr, buffer.data(), static_cast<DWORD>(buffer.size()));
        buffer.resize(length);
        return std::filesystem::path(buffer).parent_path();
    }

    void SetControlFont(HWND control, HFONT font = nullptr)
    {
        SendMessageW(control, WM_SETFONT, reinterpret_cast<WPARAM>(font ? font : g_ui.normalFont), TRUE);
    }

    HWND CreateControl(
        DWORD extendedStyle,
        wchar_t const* className,
        wchar_t const* text,
        DWORD style,
        int id)
    {
        auto control = CreateWindowExW(extendedStyle, className, text, style | WS_CHILD | WS_VISIBLE,
            0, 0, 0, 0, g_ui.window, reinterpret_cast<HMENU>(static_cast<INT_PTR>(id)),
            GetModuleHandleW(nullptr), nullptr);
        SetControlFont(control);
        SetWindowTheme(control, L"DarkMode_Explorer", nullptr);
        return control;
    }

    std::optional<std::string> JsonString(std::string const& json, std::string const& key)
    {
        auto marker = "\"" + key + "\":\"";
        auto start = json.find(marker);
        if (start == std::string::npos) return std::nullopt;
        start += marker.size();
        std::string value;
        bool escaped{};
        for (size_t index = start; index < json.size(); ++index)
        {
            char character = json[index];
            if (escaped)
            {
                switch (character)
                {
                case 'n': value.push_back('\n'); break;
                case 'r': value.push_back('\r'); break;
                case 't': value.push_back('\t'); break;
                default: value.push_back(character); break;
                }
                escaped = false;
            }
            else if (character == '\\') escaped = true;
            else if (character == '"') return value;
            else value.push_back(character);
        }
        return std::nullopt;
    }

    std::optional<double> JsonNumber(std::string const& json, std::string const& key)
    {
        auto marker = "\"" + key + "\":";
        auto start = json.find(marker);
        if (start == std::string::npos) return std::nullopt;
        start += marker.size();
        try { return std::stod(json.substr(start)); }
        catch (...) { return std::nullopt; }
    }

    void AppendLog(std::wstring const& line)
    {
        auto currentLength = GetWindowTextLengthW(g_ui.log);
        SendMessageW(g_ui.log, EM_SETSEL, currentLength, currentLength);
        auto text = (currentLength > 0 ? L"\r\n" : L"") + line;
        SendMessageW(g_ui.log, EM_REPLACESEL, FALSE, reinterpret_cast<LPARAM>(text.c_str()));
        SendMessageW(g_ui.log, EM_SCROLLCARET, 0, 0);
    }

    void SetStatus(std::wstring const& text)
    {
        SetWindowTextW(g_ui.status, text.c_str());
    }

    void EnableForm(bool enabled)
    {
        EnableWindow(g_ui.url, enabled);
        EnableWindow(g_ui.title, enabled);
        EnableWindow(g_ui.quality, enabled);
        EnableWindow(g_ui.format, enabled);
        EnableWindow(g_ui.limit, enabled);
        EnableWindow(g_ui.size, enabled && SendMessageW(g_ui.limit, BM_GETCHECK, 0, 0) == BST_CHECKED);
        EnableWindow(g_ui.discord, enabled);
        EnableWindow(g_ui.download, enabled);
        EnableWindow(g_ui.cancel, !enabled);
    }

    void LayoutControls(int width, int height)
    {
        constexpr int margin = 36;
        auto contentWidth = std::max(480, width - margin * 2);
        MoveWindow(GetDlgItem(g_ui.window, 1), margin, 24, contentWidth, 38, TRUE);
        MoveWindow(GetDlgItem(g_ui.window, 2), margin, 66, contentWidth, 24, TRUE);
        MoveWindow(GetDlgItem(g_ui.window, 3), margin, 111, contentWidth, 22, TRUE);
        MoveWindow(g_ui.url, margin, 136, contentWidth, 40, TRUE);

        MoveWindow(GetDlgItem(g_ui.window, 4), margin, 195, contentWidth, 22, TRUE);
        MoveWindow(g_ui.title, margin, 220, contentWidth, 40, TRUE);

        MoveWindow(GetDlgItem(g_ui.window, 5), margin, 281, 145, 22, TRUE);
        MoveWindow(g_ui.quality, margin, 306, 150, 220, TRUE);
        MoveWindow(GetDlgItem(g_ui.window, 6), margin + 170, 281, 120, 22, TRUE);
        MoveWindow(g_ui.format, margin + 170, 306, 125, 220, TRUE);
        MoveWindow(GetDlgItem(g_ui.window, 7), margin + 320, 281, contentWidth - 320, 22, TRUE);
        MoveWindow(GetDlgItem(g_ui.window, 9), margin + 320, 306, contentWidth - 320, 30, TRUE);
        MoveWindow(GetDlgItem(g_ui.window, 8), margin + 320, 343, contentWidth - 320, 22, TRUE);

        MoveWindow(g_ui.limit, margin, 365, 155, 32, TRUE);
        MoveWindow(g_ui.size, margin + 155, 365, 80, 34, TRUE);
        MoveWindow(g_ui.discord, margin + 247, 365, 170, 34, TRUE);
        MoveWindow(g_ui.progress, margin, 426, contentWidth, 10, TRUE);
        MoveWindow(g_ui.status, margin, 447, contentWidth, 24, TRUE);
        MoveWindow(g_ui.download, margin, 480, 190, 42, TRUE);
        MoveWindow(g_ui.cancel, margin + 202, 480, 120, 42, TRUE);
        MoveWindow(g_ui.log, margin, 544, contentWidth, std::max(100, height - 580), TRUE);
    }

    void ApplyProcessLine(std::string const& line)
    {
        auto type = JsonString(line, "type").value_or("log");
        if (type == "progress")
        {
            if (auto percent = JsonNumber(line, "percent"))
                SendMessageW(g_ui.progress, PBM_SETPOS, static_cast<WPARAM>(std::clamp(*percent, 0.0, 100.0)), 0);
            auto stage = JsonString(line, "stage").value_or("download");
            SetStatus(stage == "encode" ? L"Compression de la vidéo…" : L"Téléchargement en cours…");
            return;
        }
        if (type == "started")
        {
            SetStatus(L"Connexion à la source…");
            AppendLog(L"Téléchargement démarré.");
            return;
        }
        if (type == "encodingPlan")
        {
            AppendLog(L"Téléchargement terminé. Préparation de la compression…");
            SetStatus(L"Préparation de la compression…");
            return;
        }
        if (type == "completed")
        {
            g_ui.receivedTerminalEvent = true;
            SendMessageW(g_ui.progress, PBM_SETPOS, 100, 0);
            auto path = JsonString(line, "path").value_or("");
            auto widePath = Utf8ToWide(path);
            SetStatus(L"Terminé — la vidéo est disponible dans votre dossier Vidéos.");
            AppendLog(L"Fichier créé : " + widePath);
            return;
        }
        if (type == "error")
        {
            g_ui.receivedTerminalEvent = true;
            auto message = Utf8ToWide(JsonString(line, "message").value_or("Erreur inconnue"));
            SetStatus(L"Échec : " + message);
            AppendLog(L"Erreur : " + message);
            return;
        }
        if (auto message = JsonString(line, "message")) AppendLog(Utf8ToWide(*message));
    }

    void StartDownload()
    {
        auto url = GetText(g_ui.url);
        if (!IsSupportedUrl(url))
        {
            MessageBoxW(g_ui.window, L"Collez une URL commençant par http:// ou https://.", L"URL invalide", MB_OK | MB_ICONWARNING);
            SetFocus(g_ui.url);
            return;
        }

        auto cli = ExecutableDirectory() / L"MediaDownloader.Cli.exe";
        if (!std::filesystem::is_regular_file(cli))
        {
            MessageBoxW(g_ui.window, L"MediaDownloader.Cli.exe est absent du dossier de l'application.", L"Moteur introuvable", MB_OK | MB_ICONERROR);
            return;
        }

        if (g_ui.worker.joinable()) g_ui.worker.join();
        std::vector<std::wstring> arguments{ L"download", L"--url", url };
        auto customTitle = GetText(g_ui.title);
        if (!customTitle.empty()) arguments.insert(arguments.end(), { L"--title", customTitle });
        auto qualityIndex = static_cast<int>(SendMessageW(g_ui.quality, CB_GETCURSEL, 0, 0));
        wchar_t quality[32]{};
        SendMessageW(g_ui.quality, CB_GETLBTEXT, qualityIndex, reinterpret_cast<LPARAM>(quality));
        arguments.insert(arguments.end(), { L"--quality", qualityIndex == 0 ? L"best" : quality });

        auto formatIndex = static_cast<int>(SendMessageW(g_ui.format, CB_GETCURSEL, 0, 0));
        wchar_t format[32]{};
        SendMessageW(g_ui.format, CB_GETLBTEXT, formatIndex, reinterpret_cast<LPARAM>(format));
        std::wstring formatValue(format);
        std::transform(formatValue.begin(), formatValue.end(), formatValue.begin(), ::towlower);
        arguments.insert(arguments.end(), { L"--format", formatValue });

        if (SendMessageW(g_ui.limit, BM_GETCHECK, 0, 0) == BST_CHECKED)
        {
            auto size = GetText(g_ui.size);
            try
            {
                size_t consumed{};
                auto value = std::stod(size, &consumed);
                if (consumed != size.size() || value <= 0.0) throw std::runtime_error("invalid");
            }
            catch (...)
            {
                MessageBoxW(g_ui.window, L"Indiquez une taille maximale valide en Mo.", L"Taille invalide", MB_OK | MB_ICONWARNING);
                SetFocus(g_ui.size);
                return;
            }
            if (formatValue != L"mp4")
            {
                SendMessageW(g_ui.format, CB_SETCURSEL, 0, 0);
                arguments[arguments.size() - 1] = L"mp4";
                AppendLog(L"Le format a été réglé sur MP4 pour appliquer la limite de taille.");
            }
            arguments.insert(arguments.end(), { L"--max-size-mb", size });
        }

        SetWindowTextW(g_ui.log, L"");
        if (IsYouTubeUrl(url))
            AppendLog(L"URL YouTube détectée : utilisation automatique de la session Firefox locale.");
        SendMessageW(g_ui.progress, PBM_SETPOS, 0, 0);
        g_ui.cancelRequested = false;
        g_ui.receivedTerminalEvent = false;
        g_ui.running = true;
        EnableForm(false);
        SetStatus(L"Démarrage…");

        g_ui.worker = std::thread([cli, arguments = std::move(arguments)]
        {
            unsigned long exitCode = 4;
            try
            {
                auto result = RunProcess(cli, arguments, ExecutableDirectory(), [](std::string const& line)
                {
                    auto copy = std::make_unique<std::string>(line);
                    if (PostMessageW(g_ui.window, MessageProcessLine, 0, reinterpret_cast<LPARAM>(copy.get()))) copy.release();
                }, g_ui.cancelRequested);
                exitCode = result.exitCode;
            }
            catch (std::exception const& error)
            {
                auto line = std::make_unique<std::string>("{\"type\":\"error\",\"message\":\"" + JsonEscape(error.what()) + "\"}");
                if (PostMessageW(g_ui.window, MessageProcessLine, 0, reinterpret_cast<LPARAM>(line.get()))) line.release();
            }
            PostMessageW(g_ui.window, MessageProcessComplete, exitCode, 0);
        });
    }

    void CreateInterface(HWND window)
    {
        g_ui.window = window;
        g_ui.normalFont = CreateFontW(-17, 0, 0, 0, FW_NORMAL, FALSE, FALSE, FALSE, DEFAULT_CHARSET,
            OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY, DEFAULT_PITCH, L"Segoe UI");
        g_ui.titleFont = CreateFontW(-30, 0, 0, 0, FW_SEMIBOLD, FALSE, FALSE, FALSE, DEFAULT_CHARSET,
            OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY, DEFAULT_PITCH, L"Segoe UI Variable Display");
        g_ui.backgroundBrush = CreateSolidBrush(Background);
        g_ui.fieldBrush = CreateSolidBrush(Field);

        auto title = CreateControl(0, L"STATIC", L"Télécharger une vidéo", SS_LEFT, 1);
        SetControlFont(title, g_ui.titleFont);
        CreateControl(0, L"STATIC", L"YouTube, TikTok, X et liens vidéo directs — téléchargement local et compression automatique.", SS_LEFT, 2);
        CreateControl(0, L"STATIC", L"LIEN DE LA VIDÉO", SS_LEFT, 3);
        g_ui.url = CreateControl(WS_EX_CLIENTEDGE, L"EDIT", L"", ES_AUTOHSCROLL | WS_TABSTOP, UrlEdit);
        SendMessageW(g_ui.url, EM_SETCUEBANNER, TRUE, reinterpret_cast<LPARAM>(L"https://…"));

        CreateControl(0, L"STATIC", L"TITRE DU FICHIER (FACULTATIF)", SS_LEFT, 4);
        g_ui.title = CreateControl(WS_EX_CLIENTEDGE, L"EDIT", L"", ES_AUTOHSCROLL | WS_TABSTOP, TitleEdit);
        SendMessageW(g_ui.title, EM_LIMITTEXT, 180, 0);
        SendMessageW(g_ui.title, EM_SETCUEBANNER, TRUE, reinterpret_cast<LPARAM>(L"Laisser vide pour conserver le titre original"));

        CreateControl(0, L"STATIC", L"QUALITÉ MAXIMALE", SS_LEFT, 5);
        g_ui.quality = CreateControl(0, WC_COMBOBOXW, L"", CBS_DROPDOWNLIST | WS_TABSTOP | WS_VSCROLL, QualityCombo);
        for (auto item : { L"Best", L"2160", L"1440", L"1080", L"720", L"480", L"360" })
            SendMessageW(g_ui.quality, CB_ADDSTRING, 0, reinterpret_cast<LPARAM>(item));
        SendMessageW(g_ui.quality, CB_SETCURSEL, 3, 0);

        CreateControl(0, L"STATIC", L"FORMAT", SS_LEFT, 6);
        g_ui.format = CreateControl(0, WC_COMBOBOXW, L"", CBS_DROPDOWNLIST | WS_TABSTOP, FormatCombo);
        for (auto item : { L"MP4", L"MKV", L"WEBM" }) SendMessageW(g_ui.format, CB_ADDSTRING, 0, reinterpret_cast<LPARAM>(item));
        SendMessageW(g_ui.format, CB_SETCURSEL, 0, 0);

        CreateControl(0, L"STATIC", L"SESSION YOUTUBE", SS_LEFT, 7);
        CreateControl(0, L"STATIC", L"Firefox automatique", SS_LEFT, 9);
        CreateControl(0, L"STATIC", L"La session locale est réutilisée sans ouvrir Firefox.", SS_LEFT, 8);

        g_ui.limit = CreateControl(0, L"BUTTON", L"Limiter à", BS_AUTOCHECKBOX | WS_TABSTOP, LimitCheck);
        SendMessageW(g_ui.limit, BM_SETCHECK, BST_CHECKED, 0);
        g_ui.size = CreateControl(WS_EX_CLIENTEDGE, L"EDIT", L"10", ES_NUMBER | ES_CENTER | WS_TABSTOP, SizeEdit);
        g_ui.discord = CreateControl(0, L"BUTTON", L"Discord · 10 Mo", BS_PUSHBUTTON | WS_TABSTOP, DiscordButton);
        g_ui.progress = CreateControl(0, PROGRESS_CLASSW, L"", PBS_SMOOTH, ProgressBar);
        SendMessageW(g_ui.progress, PBM_SETRANGE, 0, MAKELPARAM(0, 100));
        SendMessageW(g_ui.progress, PBM_SETBARCOLOR, 0, RGB(139, 92, 246));
        g_ui.status = CreateControl(0, L"STATIC", L"Prêt. Les fichiers seront enregistrés dans votre dossier Vidéos.", SS_LEFT, StatusText);
        g_ui.download = CreateControl(0, L"BUTTON", L"Télécharger", BS_DEFPUSHBUTTON | WS_TABSTOP, DownloadButton);
        g_ui.cancel = CreateControl(0, L"BUTTON", L"Annuler", BS_PUSHBUTTON | WS_TABSTOP, CancelButton);
        EnableWindow(g_ui.cancel, FALSE);
        g_ui.log = CreateControl(WS_EX_CLIENTEDGE, L"EDIT", L"", ES_MULTILINE | ES_AUTOVSCROLL | ES_READONLY | WS_VSCROLL, LogEdit);
    }

    LRESULT CALLBACK WindowProcedure(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
    {
        switch (message)
        {
        case WM_CREATE:
        {
            CreateInterface(window);
            RECT bounds{};
            GetClientRect(window, &bounds);
            LayoutControls(bounds.right, bounds.bottom);
            BOOL dark = TRUE;
            DwmSetWindowAttribute(window, 20, &dark, sizeof(dark));
            return 0;
        }
        case WM_SIZE:
            LayoutControls(LOWORD(lParam), HIWORD(lParam));
            return 0;
        case WM_GETMINMAXINFO:
        {
            auto info = reinterpret_cast<MINMAXINFO*>(lParam);
            info->ptMinTrackSize = { 760, 740 };
            return 0;
        }
        case WM_COMMAND:
            switch (LOWORD(wParam))
            {
            case DownloadButton: if (HIWORD(wParam) == BN_CLICKED) StartDownload(); return 0;
            case CancelButton:
                if (HIWORD(wParam) == BN_CLICKED && g_ui.running)
                {
                    g_ui.cancelRequested = true;
                    EnableWindow(g_ui.cancel, FALSE);
                    SetStatus(L"Annulation en cours…");
                }
                return 0;
            case DiscordButton:
                if (HIWORD(wParam) == BN_CLICKED)
                {
                    SendMessageW(g_ui.limit, BM_SETCHECK, BST_CHECKED, 0);
                    SetWindowTextW(g_ui.size, L"10");
                    SendMessageW(g_ui.format, CB_SETCURSEL, 0, 0);
                    EnableWindow(g_ui.size, TRUE);
                }
                return 0;
            case LimitCheck:
                if (HIWORD(wParam) == BN_CLICKED)
                    EnableWindow(g_ui.size, SendMessageW(g_ui.limit, BM_GETCHECK, 0, 0) == BST_CHECKED);
                return 0;
            }
            break;
        case MessageProcessLine:
        {
            std::unique_ptr<std::string> line(reinterpret_cast<std::string*>(lParam));
            if (line) ApplyProcessLine(*line);
            return 0;
        }
        case MessageProcessComplete:
            g_ui.running = false;
            EnableForm(true);
            if (wParam != 0 && !g_ui.receivedTerminalEvent)
                SetStatus(g_ui.cancelRequested ? L"Téléchargement annulé." : L"Le traitement a échoué.");
            return 0;
        case WM_CTLCOLORSTATIC:
        {
            auto dc = reinterpret_cast<HDC>(wParam);
            SetTextColor(dc, GetDlgCtrlID(reinterpret_cast<HWND>(lParam)) == StatusText ? Muted : Text);
            SetBkColor(dc, Background);
            return reinterpret_cast<LRESULT>(g_ui.backgroundBrush);
        }
        case WM_CTLCOLOREDIT:
        case WM_CTLCOLORLISTBOX:
        {
            auto dc = reinterpret_cast<HDC>(wParam);
            SetTextColor(dc, Text);
            SetBkColor(dc, Field);
            return reinterpret_cast<LRESULT>(g_ui.fieldBrush);
        }
        case WM_ERASEBKGND:
        {
            RECT bounds{};
            GetClientRect(window, &bounds);
            FillRect(reinterpret_cast<HDC>(wParam), &bounds, g_ui.backgroundBrush);
            return TRUE;
        }
        case WM_CLOSE:
            g_ui.cancelRequested = true;
            if (g_ui.worker.joinable()) g_ui.worker.join();
            DestroyWindow(window);
            return 0;
        case WM_DESTROY:
            if (g_ui.worker.joinable()) g_ui.worker.join();
            DeleteObject(g_ui.normalFont);
            DeleteObject(g_ui.titleFont);
            DeleteObject(g_ui.backgroundBrush);
            DeleteObject(g_ui.fieldBrush);
            PostQuitMessage(0);
            return 0;
        }
        return DefWindowProcW(window, message, wParam, lParam);
    }
}

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE, PWSTR, int showCommand)
{
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    INITCOMMONCONTROLSEX controls{ sizeof(controls), ICC_PROGRESS_CLASS | ICC_STANDARD_CLASSES };
    InitCommonControlsEx(&controls);

    WNDCLASSEXW windowClass{ sizeof(windowClass) };
    windowClass.style = CS_HREDRAW | CS_VREDRAW;
    windowClass.lpfnWndProc = WindowProcedure;
    windowClass.hInstance = instance;
    windowClass.hCursor = LoadCursorW(nullptr, MAKEINTRESOURCEW(32512));
    windowClass.hIcon = LoadIconW(nullptr, MAKEINTRESOURCEW(32512));
    windowClass.hIconSm = windowClass.hIcon;
    windowClass.hbrBackground = CreateSolidBrush(Background);
    windowClass.lpszClassName = WindowClass;
    if (!RegisterClassExW(&windowClass)) return 1;

    auto window = CreateWindowExW(0, WindowClass, L"MediaDownloader", WS_OVERLAPPEDWINDOW,
        CW_USEDEFAULT, CW_USEDEFAULT, 940, 800, nullptr, nullptr, instance, nullptr);
    if (!window) return 1;
    ShowWindow(window, showCommand);
    UpdateWindow(window);

    MSG message{};
    while (GetMessageW(&message, nullptr, 0, 0) > 0)
    {
        TranslateMessage(&message);
        DispatchMessageW(&message);
    }
    return static_cast<int>(message.wParam);
}
