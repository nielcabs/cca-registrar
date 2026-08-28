# Diagrams (SVG + PNG)

## PNG images (ready for Word / PowerPoint)

Generated with `npm run diagrams:png` (uses [sharp](https://sharp.pixelplumbing.com/) to rasterize SVG at 150 DPI).

| PNG | Description |
|-----|-------------|
| [`png/context-diagram-level0.png`](png/context-diagram-level0.png) | Context / 0-level DFD |
| [`png/use-case-student-portal.png`](png/use-case-student-portal.png) | Student portal use case (stick figure + detail ovals, solid lines) |
| [`png/use-case-by-role.png`](png/use-case-by-role.png) | **All user roles**: Student, Registrar staff, Department officer — each with main + detail use cases |

## Editable sources (SVG)

Same filenames without `.png` in this folder — open in Inkscape or any text editor.

## Regenerate PNG after editing SVG

```bash
npm run diagrams:png
```
