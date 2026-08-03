# Host-side unit tests for the platform-free model component.
# Plain cc + vendored Unity: no ESP-IDF required (CI's fast job).
cmake_minimum_required(VERSION 3.16)
project(gtfs_compass_host_tests C)

set(CMAKE_C_STANDARD 11)
add_compile_options(-Wall -Wextra -g -fsanitize=address)
add_link_options(-fsanitize=address)

set(FW ${CMAKE_CURRENT_SOURCE_DIR}/../..)

add_executable(test_model
  test_model.c
  unity/unity.c
  ${FW}/components/model/model.c
  # ui_state.c is LVGL-free by design (plan U1) — the reconciler's races are
  # host-testable facts, so it compiles here with no LVGL on the path.
  ${FW}/components/ui/ui_state.c
  ${FW}/third_party/cjson/cJSON.c
)
target_include_directories(test_model PRIVATE
  unity
  ${FW}/components/model/include
  ${FW}/components/ui/include
  ${FW}/third_party/cjson
)
target_compile_definitions(test_model PRIVATE
  FIXTURE_DIR="${FW}/fixtures"
  CJSON_NESTING_LIMIT=48
  UNITY_INCLUDE_DOUBLE
)

# Navigation transitions (plan U3): ui_nav.c is LVGL-free by design, so the
# carousel clamp / pop-before-sys-change / identity-write rules are host
# facts, tested next to the reconciler they cooperate with.
add_executable(test_nav
  test_nav.c
  unity/unity.c
  ${FW}/components/model/model.c
  ${FW}/components/ui/ui_state.c
  ${FW}/components/ui/ui_nav.c
  ${FW}/third_party/cjson/cJSON.c
)
target_include_directories(test_nav PRIVATE
  unity
  ${FW}/components/model/include
  ${FW}/components/ui/include
  ${FW}/third_party/cjson
)
target_compile_definitions(test_nav PRIVATE
  FIXTURE_DIR="${FW}/fixtures"
  CJSON_NESTING_LIMIT=48
)

# Bike screen layout math (plan U5): ui_bike_layout.c is LVGL-free by
# design — hero strings and bar proportions under the R5 degraded
# permutations are host facts.
add_executable(test_bike_layout
  test_bike_layout.c
  unity/unity.c
  ${FW}/components/ui/ui_bike_layout.c
)
target_include_directories(test_bike_layout PRIVATE
  unity
  ${FW}/components/model/include
  ${FW}/components/ui/include
)

enable_testing()
add_test(NAME model COMMAND test_model)
add_test(NAME nav COMMAND test_nav)
add_test(NAME bike_layout COMMAND test_bike_layout)
