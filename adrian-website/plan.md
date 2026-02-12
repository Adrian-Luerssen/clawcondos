# Adrian's Personal Website - Implementation Plan

## Overview
Modern, clean personal portfolio website with dark theme, responsive design, and minimal dependencies.

---

## Phase 1: Project Setup ⚙️

### 1.1 Directory Structure
```
adrian-website/
├── index.html          # Single-page site
├── css/
│   └── styles.css      # All styles (no preprocessors)
├── js/
│   └── main.js         # Minimal JS for interactions
├── assets/
│   ├── images/         # Profile photo, project screenshots
│   └── icons/          # Social icons (inline SVG preferred)
└── README.md           # Project documentation
```

### 1.2 Technology Choices
- **HTML5** - Semantic markup
- **CSS3** - Custom properties (variables), Flexbox, Grid
- **Vanilla JS** - No frameworks, minimal scripting
- **No build tools** - Direct deployment ready

---

## Phase 2: Design System 🎨

### 2.1 Color Palette (Dark Theme)
```css
--bg-primary: #0a0a0f;       /* Deep dark background */
--bg-secondary: #12121a;     /* Card/section backgrounds */
--bg-tertiary: #1a1a24;      /* Hover states */
--text-primary: #f0f0f5;     /* Main text */
--text-secondary: #8888a0;   /* Muted text */
--accent: #6366f1;           /* Indigo accent */
--accent-hover: #818cf8;     /* Lighter accent for hover */
--border: #2a2a3a;           /* Subtle borders */
```

### 2.2 Typography
- **Headings**: Inter or system-ui (clean, modern)
- **Body**: Same family, optimized weights
- **Sizes**: Fluid typography with clamp()

### 2.3 Spacing System
- Base unit: 8px
- Scale: 4, 8, 12, 16, 24, 32, 48, 64, 96

---

## Phase 3: HTML Structure 📄

### 3.1 Sections
1. **Header/Nav** - Fixed, minimal, with smooth scroll links
2. **Hero** - Name, title/tagline, CTA buttons
3. **About** - Brief bio, skills/technologies
4. **Projects** - Grid of 3-6 featured projects
5. **Contact** - Email link, social links, optional form
6. **Footer** - Copyright, back-to-top

### 3.2 Semantic HTML
```html
<header>     <!-- Navigation -->
<main>
  <section id="hero">
  <section id="about">
  <section id="projects">
  <section id="contact">
</main>
<footer>
```

---

## Phase 4: CSS Implementation 🎭

### 4.1 Mobile-First Approach
1. Base styles for mobile (320px+)
2. Tablet breakpoint: 768px
3. Desktop breakpoint: 1024px
4. Large screens: 1440px

### 4.2 Key Features
- CSS custom properties for theming
- Smooth scroll behavior
- Subtle animations (fade-in, hover effects)
- Reduced motion support (@prefers-reduced-motion)
- Dark mode by default (light mode optional)

### 4.3 Performance
- No external CSS frameworks
- Minimal reflows (transform/opacity for animations)
- Efficient selectors

---

## Phase 5: JavaScript Features 📱

### 5.1 Core Functionality (Minimal)
- Smooth scroll for navigation links
- Mobile menu toggle
- Intersection Observer for scroll animations
- Form validation (if contact form included)

### 5.2 Progressive Enhancement
- Site works without JS
- JS adds polish, not core functionality

---

## Phase 6: Content Placeholders 📝

### 6.1 Hero Section
- Name: `[Adrian's Name]`
- Title: `[Developer / Designer / etc.]`
- Tagline: `[One-liner about what they do]`

### 6.2 About Section
- Bio paragraph (2-3 sentences)
- Skills list (6-10 technologies)
- Optional: Profile photo placeholder

### 6.3 Projects Section (3-4 cards)
- Project name
- Brief description
- Tech stack tags
- Links (live demo, GitHub)
- Screenshot placeholder

### 6.4 Contact Section
- Email link
- Social links (GitHub, LinkedIn, Twitter)
- Optional contact form

---

## Phase 7: Performance & Accessibility ♿

### 7.1 Performance Goals
- Lighthouse score: 95+
- First Contentful Paint: <1.5s
- Total page weight: <100KB (excluding images)

### 7.2 Accessibility
- Semantic HTML
- ARIA labels where needed
- Keyboard navigation
- Focus indicators
- Sufficient color contrast (WCAG AA)
- Skip to main content link

### 7.3 SEO Basics
- Meta description
- Open Graph tags
- Proper heading hierarchy
- Alt text for images

---

## Phase 8: Deployment Ready 🚀

### 8.1 Files to Deliver
- Minified CSS (optional)
- Compressed images
- README with customization instructions

### 8.2 Hosting Options
- GitHub Pages (free, simple)
- Netlify (free tier, automatic deploys)
- Vercel (free tier)

---

## Implementation Order

| Step | Task | Time Est. |
|------|------|-----------|
| 1 | Create directory structure | 5 min |
| 2 | Write base HTML with all sections | 30 min |
| 3 | CSS reset and variables | 15 min |
| 4 | Mobile styles (all sections) | 45 min |
| 5 | Tablet/desktop breakpoints | 30 min |
| 6 | Animations and interactions | 20 min |
| 7 | JavaScript functionality | 20 min |
| 8 | Accessibility audit | 15 min |
| 9 | Final polish and testing | 20 min |

**Total estimated time: ~3-4 hours**

---

## Approval Checklist

Before implementation, confirm:
- [ ] Dark theme is preferred (vs light or auto-switch)
- [ ] Sections list is correct (Hero, About, Projects, Contact)
- [ ] No contact form needed (just email link)
- [ ] Number of project cards (suggest 3-4)
- [ ] Any specific content to include?
- [ ] Preferred accent color? (default: indigo #6366f1)

---

## Next Steps

Once approved:
1. Create the file structure
2. Build HTML skeleton
3. Implement CSS
4. Add JavaScript
5. Test and deliver

**Ready for implementation on your approval!** 🎯
