# UI Fix Workflow

For layout issues, visual regressions, styling bugs.

## Detection Keywords
`layout`, `UI`, `display`, `visual`, `style`, `color`, `font`, `spacing`, `alignment`, `overflow`, `cutoff`, `overlap`

## Workflow

### Step 1: Capture Current State
- Get screenshot/recording from user
- Read project design guidelines from `mk/docs/foundation/`
- Identify exact visual discrepancy

### Step 2: Analyze
- Check layout constraints / auto-layout / ConstraintLayout
- Check dynamic text / localization overflow
- Check dark mode / theme compatibility
- Check RTL layout support

### Step 3: Common Patterns

| Pattern | Indicator | Fix |
|---------|----------|-----|
| Constraint conflict | Warning in console, broken layout | Fix conflicting constraints, set priorities |
| Text overflow | Truncated or overlapping text | Use dynamic sizing, multiline, or `adjustsFontSizeToFitWidth` |
| Theme mismatch | Wrong colors in dark/light mode | Use semantic colors from design system |
| Missing spacing | Elements too close or overlapping | Apply design system spacing tokens |
| Platform inconsistency | Looks different iOS vs Android | Check platform-specific rendering, use shared design tokens |

### Step 4: Fix & Verify
- Fix layout/styling code
- Verify on multiple screen sizes (smallest + largest supported)
- Check both light and dark mode
- Check with dynamic type / accessibility sizes

## Notes
- Always use design system tokens, not hardcoded values
- Test with longest localized string (German/Russian tend to be longest)
- Accessibility: minimum 44pt touch target, sufficient contrast ratio
