# Device-Specific Fix Workflow

For device-only crashes, screen size issues, OS version incompatibilities.

## Detection Keywords
`device`, `crash on`, `iPhone`, `iPad`, `Android`, `tablet`, `screen size`, `OS version`, `simulator works but`, `only on`

## Workflow

### Step 1: Identify Device Context
Gather from user:
- Device model + OS version
- Reproducibility (always / sometimes / specific device only)
- Crash log or screenshot if available

### Step 2: Analyze
- Check platform minimum OS version vs reported device
- Check screen size / safe area / notch handling
- Check device-specific APIs (camera, biometric, NFC)
- Check memory constraints (older devices)

### Step 3: Common Patterns

| Pattern | Indicator | Fix |
|---------|----------|-----|
| Safe area | Layout clipped on notch devices | Use safeAreaInsets / SafeArea |
| OS API | Crash on older OS | Add `@available` / `Build.VERSION` checks |
| Memory | Crash on older devices | Profile memory, reduce allocations |
| Screen size | Layout broken on small/large screens | Use adaptive layout, test constraints |
| Orientation | Crash on rotate | Handle orientation change lifecycle |

### Step 4: Fix & Verify
- Fix code with proper platform guards
- Test on target device/simulator matching reported config
- Verify no regression on other device classes

## Notes
- Always add OS version guards for new APIs
- Test both smallest and largest supported screen sizes
- Memory issues: check for retain cycles (iOS) / context leaks (Android)
