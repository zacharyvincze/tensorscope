find_package(GTest REQUIRED)

add_executable(tensorscope_tests capture_test.cpp)
target_link_libraries(tensorscope_tests PRIVATE tensorscope::capture GTest::gtest_main)
target_compile_options(tensorscope_tests PRIVATE
    $<$<CXX_COMPILER_ID:GNU,Clang>:-Wall -Wextra -Wpedantic -Werror>)
add_test(NAME tensorscope_tests COMMAND tensorscope_tests)
