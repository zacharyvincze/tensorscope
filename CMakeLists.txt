cmake_minimum_required(VERSION 3.16)
project(tensorscope VERSION 0.1.0 LANGUAGES CXX)

# Header-only capture library. Consumers link tensorscope::capture.
add_library(tensorscope_capture INTERFACE)
add_library(tensorscope::capture ALIAS tensorscope_capture)
target_include_directories(tensorscope_capture INTERFACE
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>)
target_compile_features(tensorscope_capture INTERFACE cxx_std_17)
