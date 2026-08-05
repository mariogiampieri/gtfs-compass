# Platform-free by design: no esp-* REQUIRES — the simulator build compiles
# these same sources and fails loudly if platform code leaks in.
idf_component_register(
  SRCS "model.c" "pair_fsm.c" "../../third_party/cjson/cJSON.c"
  INCLUDE_DIRS "include" "../../third_party/cjson"
)
# A hostile '[[[[…' body must exhaust the nesting budget, not the 10KB net
# task stack (review ADV-5). 48 levels is 10x the real contract's depth.
target_compile_definitions(${COMPONENT_LIB} PRIVATE CJSON_NESTING_LIMIT=48)
