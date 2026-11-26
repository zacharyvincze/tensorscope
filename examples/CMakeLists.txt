foreach(example basic without_verdicts)
    add_executable(tensorscope_example_${example} ${example}.cpp)
    target_link_libraries(tensorscope_example_${example} PRIVATE tensorscope::capture)
endforeach()
