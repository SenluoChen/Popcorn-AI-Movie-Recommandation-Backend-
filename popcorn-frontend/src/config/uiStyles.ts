// Centralized UI styles for chips/tags - frozen to keep consistent look.
// Intentionally avoids hard-coded colors; set `backgroundColor`/`color` at call sites.
export const CHIP_SX = Object.freeze({
  borderRadius: 999,
  border: "1px solid var(--border-1)",
  boxShadow: "var(--shadow-1)",
  height: 26,
  textTransform: "none",
  "& .MuiChip-label": {
    paddingLeft: 8,
    paddingRight: 8,
    paddingTop: 3,
    paddingBottom: 3,
    fontWeight: 700,
    fontSize: "0.75rem",
    lineHeight: 1.1,
    letterSpacing: 0.2,
  },
  "& .MuiChip-icon": {
    marginLeft: 8,
  },
  "& .MuiChip-deleteIcon": {
    marginRight: 6,
  },
});

export default CHIP_SX;
