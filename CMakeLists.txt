cmake_minimum_required(VERSION 3.24)
project(MediaDownloader VERSION 0.1.0 LANGUAGES CXX)

if(NOT WIN32)
    message(FATAL_ERROR "MediaDownloader cible actuellement Windows uniquement.")
endif()

add_library(MediaDownloaderCore
    src/Core.cpp
    src/Core.h
)
target_compile_features(MediaDownloaderCore PUBLIC cxx_std_20)
target_include_directories(MediaDownloaderCore PUBLIC src)
target_compile_definitions(MediaDownloaderCore PUBLIC NOMINMAX WIN32_LEAN_AND_MEAN)

add_executable(MediaDownloaderCli
    src/Main.cpp
    src/Process.cpp
    src/ChildProcess.h
)
set_target_properties(MediaDownloaderCli PROPERTIES OUTPUT_NAME "MediaDownloader.Cli")
target_compile_features(MediaDownloaderCli PRIVATE cxx_std_20)
target_link_libraries(MediaDownloaderCli PRIVATE MediaDownloaderCore shell32 ole32)

add_executable(MediaDownloader WIN32
    src/Gui.cpp
    src/Process.cpp
    src/ChildProcess.h
)
target_compile_features(MediaDownloader PRIVATE cxx_std_20)
target_link_libraries(MediaDownloader PRIVATE MediaDownloaderCore comctl32 dwmapi shell32 uxtheme)

if(MSVC)
    target_compile_options(MediaDownloaderCore PRIVATE /W4 /permissive- /utf-8)
    target_compile_options(MediaDownloaderCli PRIVATE /W4 /permissive- /utf-8)
    target_compile_options(MediaDownloader PRIVATE /W4 /permissive- /utf-8)
endif()

foreach(tool yt-dlp.exe ffmpeg.exe ffprobe.exe)
    if(EXISTS "${CMAKE_SOURCE_DIR}/tools/bin/${tool}")
        add_custom_command(TARGET MediaDownloader POST_BUILD
            COMMAND ${CMAKE_COMMAND} -E make_directory "$<TARGET_FILE_DIR:MediaDownloader>/tools/bin"
            COMMAND ${CMAKE_COMMAND} -E copy_if_different
                "${CMAKE_SOURCE_DIR}/tools/bin/${tool}"
                "$<TARGET_FILE_DIR:MediaDownloader>/tools/bin/${tool}"
        )
    endif()
endforeach()

enable_testing()
add_executable(MediaDownloaderTests tests/CoreTests.cpp)
target_compile_features(MediaDownloaderTests PRIVATE cxx_std_20)
target_link_libraries(MediaDownloaderTests PRIVATE MediaDownloaderCore)
if(MSVC)
    target_compile_options(MediaDownloaderTests PRIVATE /W4 /permissive- /utf-8)
    set_property(TARGET MediaDownloaderCore MediaDownloaderCli MediaDownloader MediaDownloaderTests
        PROPERTY MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
endif()
add_test(NAME MediaDownloaderCoreTests COMMAND MediaDownloaderTests)
