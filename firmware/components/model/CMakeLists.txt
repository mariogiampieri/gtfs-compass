# Platform-free by design: no esp-* REQUIRES — the simulator build compiles
# these same sources and fails loudly if platform code leaks in.
idf_component_register(
  SRCS "model.c" "../../third_party/cjson/cJSON.c"
  INCLUDE_DIRS "include" "../../third_party/cjson"
)
