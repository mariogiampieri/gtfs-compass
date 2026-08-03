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
  ${FW}/third_party/cjson/cJSON.c
)
target_include_directories(test_model PRIVATE
  unity
  ${FW}/components/model/include
  ${FW}/third_party/cjson
)
target_compile_definitions(test_model PRIVATE
  FIXTURE_DIR="${FW}/fixtures"
  CJSON_NESTING_LIMIT=48
  UNITY_INCLUDE_DOUBLE
)

enable_testing()
add_test(NAME model COMMAND test_model)
