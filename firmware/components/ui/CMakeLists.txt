# LVGL-only component (no esp-* beyond the lvgl dependency the BSP pins).
idf_component_register(
  SRCS "ui_board.c" "ui_state.c" "ui_input.c"
  INCLUDE_DIRS "include" "."
  REQUIRES lvgl model
)
