# macOS SDL simulator: the same ui/ + model/ the device runs, in a 410x502
# window, fed by fixture JSON (including captured live /v1/nearby bodies).
cmake_minimum_required(VERSION 3.16)
project(gtfs_compass_sim C)

set(CMAKE_C_STANDARD 11)
add_compile_options(-Wall -Wextra -g)

set(FW ${CMAKE_CURRENT_SOURCE_DIR}/..)

find_package(SDL2 REQUIRED)

# LVGL from the pinned submodule; sim/lv_conf.h is a one-line wrapper around
# the repo's canonical firmware/lv_conf.h (LVGL's desktop build requires the
# file to sit at the project root).
add_compile_definitions(SIM_BUILD)
add_subdirectory(${FW}/third_party/lvgl ${CMAKE_BINARY_DIR}/lvgl)
# LVGL's SDL driver needs the SDL headers/libs too (Homebrew prefix).
get_filename_component(SDL2_PARENT_DIR "${SDL2_INCLUDE_DIRS}" DIRECTORY)
target_include_directories(lvgl PUBLIC ${SDL2_INCLUDE_DIRS} ${SDL2_PARENT_DIR})
target_link_libraries(lvgl PUBLIC ${SDL2_LIBRARIES})

add_executable(sim
  main.c
  ${FW}/components/model/model.c
  ${FW}/components/ui/ui_board.c
  ${FW}/third_party/cjson/cJSON.c
)
target_include_directories(sim PRIVATE
  ${FW}/components/model/include
  ${FW}/components/ui/include
  ${FW}/components/ui
  ${FW}/third_party/cjson
  ${SDL2_INCLUDE_DIRS}
)
target_link_libraries(sim lvgl ${SDL2_LIBRARIES})
target_compile_definitions(sim PRIVATE FIXTURE_DIR="${FW}/fixtures")
