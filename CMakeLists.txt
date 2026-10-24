cmake_minimum_required(VERSION 3.24)
project(MediaDownloader VERSION 0.2.0 LANGUAGES CXX)

add_library(MediaDownloaderCore
    src/Core.cpp
    src/Core.h
    src/TemporaryFiles.cpp
    src/TemporaryFiles.h
)
target_compile_features(MediaDownloaderCore PUBLIC cxx_std_20)
target_include_directories(MediaDownloaderCore PUBLIC src)
if(WIN32)
    target_compile_definitions(MediaDownloaderCore PUBLIC NOMINMAX WIN32_LEAN_AND_MEAN)
    set(MEDIADOWNLOADER_PROCESS_SOURCE src/Process.cpp)
else()
    set(MEDIADOWNLOADER_PROCESS_SOURCE src/ProcessPosix.cpp)
endif()

add_library(MediaDownloaderEngine
    src/Engine.cpp
    src/Engine.h
    src/Host.cpp
    src/Host.h
    ${MEDIADOWNLOADER_PROCESS_SOURCE}
    src/ChildProcess.h
)
target_compile_features(MediaDownloaderEngine PUBLIC cxx_std_20)
target_link_libraries(MediaDownloaderEngine PUBLIC MediaDownloaderCore)
if(WIN32)
    target_link_libraries(MediaDownloaderEngine PUBLIC shell32 ole32 advapi32)
endif()

add_executable(MediaDownloaderCli src/Main.cpp)
set_target_properties(MediaDownloaderCli PROPERTIES OUTPUT_NAME "MediaDownloader.Cli")
target_compile_features(MediaDownloaderCli PRIVATE cxx_std_20)
target_link_libraries(MediaDownloaderCli PRIVATE MediaDownloaderEngine)

if(WIN32)
    add_executable(MediaDownloader WIN32 src/Gui.cpp src/Process.cpp src/ChildProcess.h)
    target_compile_features(MediaDownloader PRIVATE cxx_std_20)
    target_link_libraries(MediaDownloader PRIVATE MediaDownloaderCore comctl32 dwmapi shell32 uxtheme)
endif()

if(MSVC)
    target_compile_options(MediaDownloaderCore PRIVATE /W4 /permissive- /utf-8)
    target_compile_options(MediaDownloaderEngine PRIVATE /W4 /permissive- /utf-8)
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
    set_property(TARGET MediaDownloaderCore MediaDownloaderEngine MediaDownloaderCli MediaDownloader MediaDownloaderTests
        PROPERTY MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
endif()
add_test(NAME MediaDownloaderCoreTests COMMAND MediaDownloaderTests)
if(NOT WIN32)
    add_executable(MediaDownloaderProcessTests tests/ProcessTests.cpp src/ProcessPosix.cpp)
    target_compile_features(MediaDownloaderProcessTests PRIVATE cxx_std_20)
    target_link_libraries(MediaDownloaderProcessTests PRIVATE MediaDownloaderCore)
    add_test(NAME MediaDownloaderProcessTests COMMAND MediaDownloaderProcessTests)
endif()

add_executable(MediaDownloaderContractTests tests/ContractTests.cpp)
add_dependencies(MediaDownloaderContractTests MediaDownloaderCli)
target_compile_features(MediaDownloaderContractTests PRIVATE cxx_std_20)
target_compile_definitions(MediaDownloaderContractTests PRIVATE
    MD_CLI_PATH="$<TARGET_FILE:MediaDownloaderCli>"
    MD_FAKE_TOOLS_DIR="${CMAKE_SOURCE_DIR}/tests/fake-tools")
if(MSVC)
    target_compile_options(MediaDownloaderContractTests PRIVATE /W4 /permissive- /utf-8)
    set_property(TARGET MediaDownloaderContractTests PROPERTY MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
endif()
add_test(NAME MediaDownloaderContractTests COMMAND MediaDownloaderContractTests)
set_tests_properties(MediaDownloaderContractTests PROPERTIES SKIP_RETURN_CODE 77)

install(TARGETS MediaDownloaderCli RUNTIME DESTINATION .)
if(WIN32)
    install(TARGETS MediaDownloader RUNTIME DESTINATION .)
endif()

add_executable(MediaDownloaderHostTests tests/HostTests.cpp)
add_dependencies(MediaDownloaderHostTests MediaDownloaderCli)
target_compile_features(MediaDownloaderHostTests PRIVATE cxx_std_20)
target_link_libraries(MediaDownloaderHostTests PRIVATE MediaDownloaderEngine)
target_compile_definitions(MediaDownloaderHostTests PRIVATE
    MD_CLI_PATH="$<TARGET_FILE:MediaDownloaderCli>"
    MD_FAKE_TOOLS_DIR="${CMAKE_SOURCE_DIR}/tests/fake-tools")
if(MSVC)
    target_compile_options(MediaDownloaderHostTests PRIVATE /W4 /permissive- /utf-8)
    set_property(TARGET MediaDownloaderHostTests PROPERTY MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
endif()
add_test(NAME MediaDownloaderHostTests COMMAND MediaDownloaderHostTests)
set_tests_properties(MediaDownloaderHostTests PROPERTIES SKIP_RETURN_CODE 77)
