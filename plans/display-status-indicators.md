# Display Status Indicators Implementation Plan

## Problem
Virtual displays in the 3D room configuration that have no physical room-device (slot) assigned to them need visual indicators to show their availability status.

## Requirements
- **Blue border**: Display is available (exists in room config but no slot assigned)
- **Black background**: Display is unavailable (excluded or no camera configured)
- **Video feed**: Display has a remote user assigned to it

## Implementation Steps

### 1. Modify DisplayPickerComponent
Location: `client-app/src/app/components/display-picker/display-picker.component.ts`

**Add display state detection logic:**
- In `updateDisplayPlanes()`, determine the state of each display:
  - **Available (blue)**: Display exists in roomConfig.displays but has NO matching slot in topology
  - **Unavailable (black)**: Display exists but slot is excluded OR slot has no camera
  - **Has remote (video)**: Display has a slot with assigned remote participants

**Add visual indicator via material color:**
- Use `MeshBasicMaterial` with different colors based on state:
  - Available: Blue color (0x0000FF) with transparency
  - Unavailable: Black color (0x000000)
  - Has remote: Use video texture (current behavior)

### 2. Update DisplayPickerComponent styles
Location: `client-app/src/app/components/display-picker/display-picker.component.scss`

Add CSS for status indicators and instructions overlay.

## Technical Details

### Display States
```typescript
enum DisplayState {
  AVAILABLE = 'available',      // Blue - no slot assigned
  UNAVAILABLE = 'unavailable',  // Black - excluded/no camera
  HAS_REMOTE = 'has_remote'     // Video feed - remote assigned
}
```

### Logic in updateDisplayPlanes()
For each display in `roomConfig.displays`:
1. Find matching slot in `topology.slots` by `displayId`
2. If no slot found → **AVAILABLE** (blue border)
3. If slot found:
   - If `slot.excluded` → **UNAVAILABLE** (black)
   - If `!slot.cameraProducerId` → **UNAVAILABLE** (black)
   - If `slot.assignedRemoteIds.length > 0` → **HAS_REMOTE** (video)
   - Otherwise → **AVAILABLE** (blue border)

### Visual Implementation
- Use `THREE.MeshBasicMaterial` with:
  - `color`: Blue (0x0066ff) for available, Black (0x000000) for unavailable
  - `transparent`: true, `opacity`: 0.3 for available (border effect)
  - For video: Keep current video texture approach
- Add a secondary "border mesh" slightly larger than the display plane for the blue border effect