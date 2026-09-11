# UI/UX Requirements

Screen map, navigation flows, interaction specs from Figma.

## Screen Inventory

From Figma `design.json` screens[]:

```markdown
| # | Screen | Type | Components | Entry Point |
|---|--------|------|------------|-------------|
| 1 | SplashScreen | launch | logo, loading | App start |
| 2 | LoginScreen | form | email, password, social buttons | Splash → Login |
| 3 | HomeScreen | list | header, search, product cards | Login → Home |
```

Type classification:
- `launch` — splash, onboarding
- `list` — scrollable content (products, messages, feed)
- `detail` — single item view
- `form` — input/edit (login, register, profile edit)
- `modal` — overlay (confirmation, picker, alert)
- `settings` — configuration screens

## Navigation Flow

From Figma interactions[]:

```markdown
## Navigation Map

Splash → [Auth Check]
  ├── Logged in → Home
  └── Not logged in → Login
       ├── Register → Verification → Home
       └── Forgot Password → Reset → Login

Home → ProductDetail → Cart → Checkout → OrderConfirmation
Home → Profile → EditProfile
Home → Settings → Notifications
```

## Interaction Specs

For each screen, note key interactions:
- Gestures: pull-to-refresh, swipe-to-delete, long-press
- Animations: transitions, loading states, skeleton screens
- Input validation: inline errors, format masks
- Empty states: no data, no network, error

## Design Tokens Reference

From Figma `design.tokens`:
- Color palette → reference `bk/docs/foundation/architecture.md` design tokens
- Typography scale → font requirements
- Spacing system → layout consistency

## Output

Write screen inventory + navigation map + interaction specs.
Cross-link each screen to related use cases (UC-*) and endpoints (API).

Skip entire section if no Figma input — note: "UI/UX requirements pending design input."
