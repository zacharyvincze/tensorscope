cmake_minimum_required(VERSION 3.16)
project(tensorscope VERSION 0.1.0 LANGUAGES CXX)  # x-release-please-version

# Header-only capture library. Consumers link tensorscope::capture.
add_library(tensorscope_capture INTERFACE)
add_library(tensorscope::capture ALIAS tensorscope_capture)
target_include_directories(tensorscope_capture INTERFACE
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>)
target_compile_features(tensorscope_capture INTERFACE cxx_std_17)

option(TENSORSCOPE_BUILD_EXAMPLES "Build the example program" OFF)
if(TENSORSCOPE_BUILD_EXAMPLES)
    add_subdirectory(examples)
endif()

option(TENSORSCOPE_BUILD_TESTS "Build the capture library's tests (needs GoogleTest)" OFF)
if(TENSORSCOPE_BUILD_TESTS)
    enable_testing()
    add_subdirectory(tests)
endif()
