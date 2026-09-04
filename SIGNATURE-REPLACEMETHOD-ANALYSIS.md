# Google Slides API replaceAllShapesWithImage Analysis

## 1. ALL USAGES FOUND

### Location 1: driveService.js Line 2237 (Firma Instructor)
```javascript
if (firmaUrl) {
    requests.push({
        replaceAllShapesWithImage: {
            imageUrl: firmaUrl,
            replaceMethod: 'CENTER_INSIDE',
            containsText: { text: '{{firma_instructor}}', matchCase: false }
        }
    });
}
```

### Location 2: driveService.js Line 2254 (Firma Calidad)
```javascript
if (firmaCalidadUrl) {
    requests.push({
        replaceAllShapesWithImage: {
            imageUrl: firmaCalidadUrl,
            replaceMethod: 'CENTER_INSIDE',
            containsText: { text: '{{firma_calidad}}', matchCase: false }
        }
    });
}
```

### Location 3-6: server.js - Documentation Comments
- Line 9983: `// via replaceAllShapesWithImage (no como texto)`
- Line 9990: `// Usamos lh3.googleusercontent.com para URL directa (requerido por Google Slides API replaceAllShapesWithImage)`
- Line 10025: `firmaInstructorUrl, // {{firma_instructor}} → replaceAllShapesWithImage`
- Line 10026: `firmaCalidadUrl     // {{firma_calidad}}    → replaceAllShapesWithImage`

---

## 2. GOOGLE SLIDES API replaceMethod OPTIONS

### CENTER_INSIDE (Currently Used)
```
**How it works:** Fit entire image inside the shape while maintaining aspect ratio
**Behavior:** 
  - Preserves 100% of image aspect ratio
  - Centers image within the shape
  - Empty space fills with background/white
  - Never crops or distorts the image
**Use case:** Signatures, logos, photos where quality/completeness matters
**Problem:** Can leave empty space if shape has different aspect ratio than image
```

### CENTER_CROP (NOT Currently Used)
```
**How it works:** Crop image to fit the shape while maintaining aspect ratio
**Behavior:** 
  - Preserves aspect ratio
  - Centers and crops image to fill entire shape
  - NO empty space - fills entire shape area
  - Parts of image may be cut off (cropped)
**Use case:** Background images, profile photos where filling the space is priority
**Problem:** May lose important parts of image (e.g., edges of signature)
```

### SCALE (NOT Currently Used)
```
**How it works:** Stretch/scale image to fill entire shape
**Behavior:** 
  - Stretches image to 100% fill shape width AND height
  - DOES NOT preserve aspect ratio
  - Fills entire shape completely
  - Image may appear distorted (stretched/squished)
**Use case:** Stylized graphics where distortion is acceptable
**Problem:** Signatures get stretched/distorted - completely unacceptable for formal documents
```

---

## 3. CURRENT PROBLEMATIC BEHAVIOR & WHY SIGNATURES LOOK DIFFERENT

### Root Cause: Pre-adjustment + Inconsistent Aspect Ratios

#### Phase 1: Template Pre-Adjustment (prepararTemplateAjustado)
Located at driveService.js lines 2142-2191:

```javascript
// Create adjusted template ONCE per batch
async function prepararTemplateAjustado(templateId, firmaUrl, firmaCalidadUrl) {
    // Scales and repositions signature placeholders
    const scale = isFirmaInstructor ? 1.9 : 1.7;  // 90% larger for instructor, 70% for quality
    const origW = el.size?.width?.magnitude || 1800000;
    const origH = el.size?.height?.magnitude || 600000;
    
    // Also shifts positions:
    const instructorShiftRight = 130000;  // ~3.7mm right
    const shiftUp = -200000;              // ~5.6mm up
}
```

#### Phase 2: Image Replacement (CENTER_INSIDE)
Then DURING PDF generation, `CENTER_INSIDE` applies to the pre-scaled shapes:

1. **Shape dimensions vary** (scaleX, scaleY differences in templates)
2. **Signature dimensions vary** (different instructor signatures, different aspect ratios)
3. **CENTER_INSIDE behavior:** Fits entire image while preserving aspect ratio
   - If signature is TALLER than wide: image shrinks to fit height → extra white space left/right
   - If signature is WIDER than tall: image shrinks to fit width → extra white space top/bottom
   - Exact empty space depends on BOTH shape aspect ratio AND image aspect ratio

#### Why They Look Different:
- **Instructor signatures** get 1.9x scale
- **Quality signatures** get 1.7x scale
- Different instructors have different **aspect ratios** (some very wide/flat, some tall/narrow)
- Each combination of (shape dimensions × instructor's signature aspect ratio) produces different visual result
- WHITE SPACE INCONSISTENCY: Some signatures show more white space around them than others

### Problem Summary:
```
╔════════════════════════════════════════════════════════════════╗
║ SIGNATURE SIZING/APPEARANCE INCONSISTENCY                      ║
╠════════════════════════════════════════════════════════════════╣
║ • Different signatures look different sizes visually           ║
║ • Different amounts of white space around each signature       ║
║ • Hard to predict final appearance without generating PDF      ║
║                                                                 ║
║ ROOT CAUSES:                                                    ║
║ 1. CENTER_INSIDE leaves variable white space based on aspect   ║
║    ratio mismatch between shape and image                      ║
║ 2. Pre-adjustment only scales placeholder shape, not final     ║
║    rendered signature                                          ║
║ 3. No control over what CENTER_INSIDE does - pure Google API  ║
║    behavior beyond our code                                    ║
╚════════════════════════════════════════════════════════════════╝
```

---

## 4. TECHNICAL DETAILS: How Signatures Get Processed

### Step 1: Template Initialization
- Template has shape with text `{{firma_instructor}}`
- Shape has initial dimensions (width/height in EMUs - English Metric Units)

### Step 2: Pre-Adjustment (if signatures provided)
```javascript
// driveService.js prepararTemplateAjustado()
updatePageElementTransform: {
    scaleX: origScaleX * 1.9,    // Scale 90% larger
    scaleY: origScaleY * 1.9,
    translateX: ... - 130000,     // Move right
    translateY: ... - 200000      // Move up
}
```
⚠️ **Important:** This adjusts the PLACEHOLDER shape, not the actual signature image

### Step 3: Text Replacement → Image Insertion (CENTER_INSIDE)
```javascript
// When batchUpdate runs:
replaceAllShapesWithImage: {
    imageUrl: 'https://lh3.googleusercontent.com/d/...',
    replaceMethod: 'CENTER_INSIDE',  // Google Slides API decides final sizing
    containsText: { text: '{{firma_instructor}}' }
}
```

Google Slides API then:
1. Finds shape with `{{firma_instructor}}` text
2. Downloads image from URL
3. **Measures image aspect ratio**
4. Measures shape aspect ratio
5. Applies CENTER_INSIDE logic:
   - Scale image to fit inside shape
   - Center it
   - Leave empty space if aspect ratios don't match

---

## 5. ALTERNATIVE REPLACEMETHOD OPTIONS ANALYSIS

| Method | Pros | Cons | Best For |
|--------|------|------|----------|
| **CENTER_INSIDE** (current) | ✅ Preserves quality<br>✅ No distortion<br>✅ Whole signature visible | ❌ Inconsistent white space<br>❌ Variable visual size<br>❌ Different look per signature | General use, quality documents |
| **CENTER_CROP** | ✅ Fills entire shape<br>✅ Consistent appearance<br>✅ Professional look | ❌ May crop important parts<br>❌ Risk cutting signature edges<br>❌ Data loss | Not recommended for signatures |
| **SCALE** | ✅ Fills entire shape<br>✅ No empty space | ❌ DISTORTS image<br>❌ Looks unprofessional<br>❌ Stretches signatures | Not suitable - looks bad |

---

## 6. WHY SIGNATURES APPEAR DIFFERENT - VISUAL EXAMPLES

### Scenario A: Wide/Flat Signature (2:1 ratio)
```
Shape (assumed): 1800000 EMU × 600000 EMU (3:1 ratio)
Image aspect: 2:1 (wide signature)

CENTER_INSIDE Result:
┌─────────────────────────────┐
│    [      SIGNATURE      ]  │ ← Centers horizontally
│                             │ ← Extra space top/bottom
└─────────────────────────────┘

Visible white space: Top/bottom
```

### Scenario B: Tall/Narrow Signature (1:2 ratio)
```
Shape (assumed): 1800000 EMU × 600000 EMU (3:1 ratio)
Image aspect: 1:2 (tall signature)

CENTER_INSIDE Result:
┌─────────────────────────────┐
│   |S| 
│   |I| ← Fits height, extra space left/right
│   |G|
└─────────────────────────────┘

Visible white space: Left/right
```

Both signatures look DIFFERENT SIZES and DIFFERENT AMOUNTS OF SPACE
even though they use the same `CENTER_INSIDE` method!

---

## 7. SIZING/POSITIONING DOCUMENTATION IN CODE

### From driveService.js (prepararTemplateAjustado):
```javascript
const origScaleX = el.transform.scaleX || 1;
const origScaleY = el.transform.scaleY || 1;
const origW = el.size?.width?.magnitude || 1800000;  // Default 1800000 EMU
const origH = el.size?.height?.magnitude || 600000;  // Default 600000 EMU
const scale = isFirmaInstructor ? 1.9 : 1.7;         // Scale factor
// Grow from center: compensate X/Y for size increase
const deltaW = origW * (scale - 1) * origScaleX / 2;
const deltaH = origH * (scale - 1) * origScaleY / 2;
const instructorShiftRight = 130000;  // ~3.7mm
const shiftUp = -200000;              // ~5.6mm
```

**EMU (English Metric Units):** 914400 EMU = 1 inch
- 1800000 EMU ≈ 1.97 inches (≈ 50mm)
- 600000 EMU ≈ 0.66 inches (≈ 16.7mm)
- 130000 EMU ≈ 0.14 inches (≈ 3.7mm)
- 200000 EMU ≈ 0.22 inches (≈ 5.6mm)

### Scaling Applied:
- **Instructor signature:** Shape scales to 1.9x original size
- **Quality signature:** Shape scales to 1.7x original size
- **Both:** Shifted up 5.6mm and right (instructor only 3.7mm more)

---

## 8. CONCLUSION: KEY TAKEAWAYS

1. **Current Method (CENTER_INSIDE):** Best choice for quality preservation, but causes visual inconsistency due to aspect ratio mismatches

2. **Why Different Appearance:** Not a bug—it's how CENTER_INSIDE works:
   - Each signature has different aspect ratio
   - Each shape has fixed dimensions
   - CENTER_INSIDE centers and scales to fit
   - Variable white space = variable visual appearance

3. **Pre-adjustment Strategy:** The 1.9x/1.7x scaling is correct, but it only scales the PLACEHOLDER, not the final image. Google Slides API handles final sizing after text→image replacement.

4. **Recommended Solutions:**
   - **Option A:** Use CENTER_CROP (if cropping edges is acceptable)
   - **Option B:** Normalize signature aspect ratios before storing (edit signatures to be consistent)
   - **Option C:** Accept current behavior as "working as designed"
   - **Option D:** Store multiple template variations (one per signature aspect ratio)
