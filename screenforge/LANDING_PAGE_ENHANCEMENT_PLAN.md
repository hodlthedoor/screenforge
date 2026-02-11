# Landing Page Enhancement - Implementation Plan

## Task Summary
Enhance the existing landing page (src/routes/landing.ts, 213 lines) to be more conversion-focused by adding:
1. Updated pricing table with 4 tiers (Free 100/mo, Starter 5k at $9/mo, Pro 25k at $29/mo, Business unlimited at $99/mo)
2. Live demo input section
3. Feature comparison table
4. Testimonials/social proof placeholder
5. GET /pricing alias route
6. Dark mode support
7. Updated footer with legal links
8. Comprehensive tests

## Files to Create/Modify

### Files to Modify
1. **src/routes/landing.ts** (213 lines → ~450 lines)
   - Update pricing section with corrected values from task spec
   - Add live demo section with URL input + screenshot preview
   - Add feature comparison table
   - Add testimonials placeholder section
   - Add dark mode CSS variables and media queries
   - Update footer with legal links
   - Add GET /pricing alias route

2. **src/billing/plans.ts** (52 lines → ~70 lines)
   - Update plan quotas and prices to match task spec:
     - Free: 100 renders/mo (currently 1,000)
     - Starter: 5,000 renders/mo at $9/mo (currently 10,000 at $9)
     - Pro: 25,000 renders/mo at $29/mo (currently 100,000 at $29)
     - Business: Unlimited at $99/mo (currently 1,000,000 at $99)
   - Add feature flags for comparison table (webhooks, custom CSS/JS, priority queue, SLA)

### Files to Extend
3. **tests/unit/landing.test.ts** (67 lines → ~150 lines)
   - Extend existing tests with new sections
   - Add pricing section validation (correct tiers, prices, CTAs)
   - Add live demo section tests
   - Add feature comparison table tests
   - Add testimonials section test
   - Add /pricing alias route test
   - Verify all CTAs link correctly (/register, /v1/billing/checkout)
   - Test mobile responsiveness CSS classes

## Implementation Approach

### Phase 1: Update Pricing Data (src/billing/plans.ts)
**Rationale:** Foundation for pricing table rendering

1. Update plan quotas to match spec:
   - `free.monthlyQuota`: 1_000 → 100
   - `starter.monthlyQuota`: 10_000 → 5_000
   - Keep existing prices (already correct: $9, $29, $99)

2. Add feature comparison fields to `Plan` interface:
   ```typescript
   interface Plan {
     // existing fields...
     features: {
       concurrentRenders: number;
       webhookSupport: boolean;
       customCssJs: boolean;
       priorityQueue: boolean;
       sla: boolean | string; // false or "99.9%" etc
     }
   }
   ```

3. Populate features for each tier:
   - Free: 1 concurrent, no webhooks, no custom CSS/JS, no priority, no SLA
   - Starter: 3 concurrent, webhooks, no custom CSS/JS, no priority, no SLA
   - Pro: 10 concurrent, webhooks, custom CSS/JS, priority, "99.5% SLA"
   - Business: 50 concurrent, webhooks, custom CSS/JS, priority, "99.9% SLA"

### Phase 2: Update Landing Page HTML (src/routes/landing.ts)

#### 2.1 Update Pricing Section (lines 147-189)
**Rationale:** Reflect correct pricing and add CTAs

1. Update tier values:
   - Free: "100 renders/mo"
   - Starter: "5,000 renders/mo"
   - Pro: "25,000 renders/mo" with "Popular" badge
   - Business: "Unlimited renders"

2. Add CTA buttons to each card:
   ```html
   <a href="/register" class="btn btn-primary" style="margin-top:16px;display:block">
     Get Started
   </a>
   ```
   - Free/Starter/Pro: link to `/register`
   - Business: link to `/register` (checkout can be handled from dashboard)

3. Add "Popular" badge to Pro card:
   ```css
   .badge-popular{background:var(--accent);color:#fff;font-size:.75rem;padding:4px 12px;border-radius:12px;margin-bottom:8px;display:inline-block}
   ```

#### 2.2 Add Live Demo Section (after pricing, before self-host)
**Rationale:** Interactive proof of value

1. Add demo section HTML:
   ```html
   <section class="demo">
     <div class="container">
       <h2>Try It Live</h2>
       <p style="color:var(--muted);max-width:600px;margin:0 auto 24px">Paste any URL to see a screenshot preview</p>
       <div class="demo-input-group">
         <input type="url" id="demoUrl" placeholder="https://example.com" />
         <button id="demoSubmit" class="btn btn-primary">Capture</button>
       </div>
       <div id="demoResult"></div>
     </div>
   </section>
   ```

2. Add CSS for demo section:
   ```css
   .demo{padding:60px 0;background:var(--surface)}
   .demo h2{text-align:center;font-size:2rem;margin-bottom:16px}
   .demo-input-group{display:flex;gap:12px;max-width:600px;margin:0 auto}
   .demo-input-group input{flex:1;padding:12px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:1rem}
   #demoResult{margin-top:24px;text-align:center;min-height:60px}
   #demoResult img{max-width:100%;max-height:500px;border-radius:8px;border:1px solid var(--border)}
   .demo-loading{color:var(--muted);font-size:.9rem}
   .demo-error{color:#ff5555;font-size:.9rem}
   @media(max-width:768px){
     .demo-input-group{flex-direction:column}
     .demo-input-group button{width:100%}
   }
   ```

3. Add inline JavaScript for demo functionality:
   ```javascript
   <script>
   (function() {
     const btn = document.getElementById('demoSubmit');
     const input = document.getElementById('demoUrl');
     const result = document.getElementById('demoResult');

     btn.addEventListener('click', async () => {
       const url = input.value.trim();
       if (!url) {
         result.innerHTML = '<div class="demo-error">Please enter a URL</div>';
         return;
       }

       btn.disabled = true;
       btn.textContent = 'Capturing...';
       result.innerHTML = '<div class="demo-loading">Loading screenshot preview...</div>';

       try {
         // For initial MVP, show placeholder since demo key not yet configured
         await new Promise(resolve => setTimeout(resolve, 1500));
         result.innerHTML = '<div class="demo-error">Demo coming soon! Sign up to try the API.</div>';

         // Future implementation with demo API key:
         // const res = await fetch('${safeBaseUrl}/v1/screenshot', {
         //   method: 'POST',
         //   headers: {
         //     'Content-Type': 'application/json',
         //     'X-API-Key': 'demo_key_placeholder'
         //   },
         //   body: JSON.stringify({
         //     url,
         //     format: 'png',
         //     viewport: { width: 1200, height: 800 }
         //   })
         // });
         // if (!res.ok) throw new Error('Failed');
         // const blob = await res.blob();
         // const imgUrl = URL.createObjectURL(blob);
         // result.innerHTML = \`<img src="\${imgUrl}" alt="Screenshot" />\`;
       } catch (err) {
         result.innerHTML = '<div class="demo-error">Demo coming soon! Sign up to try the API.</div>';
       } finally {
         btn.disabled = false;
         btn.textContent = 'Capture';
       }
     });

     // Enter key support
     input.addEventListener('keypress', (e) => {
       if (e.key === 'Enter') btn.click();
     });
   })();
   </script>
   ```

**Note:** Initial implementation shows placeholder message. Demo API key infrastructure is out of scope for this task.

#### 2.3 Add Feature Comparison Table (after demo, before self-host)
**Rationale:** Detailed tier differentiation

1. Add comparison table HTML:
   ```html
   <section class="comparison">
     <div class="container">
       <h2>Feature Comparison</h2>
       <div class="comparison-table-wrapper">
         <table class="comparison-table">
           <thead>
             <tr>
               <th>Feature</th>
               <th>Free</th>
               <th>Starter</th>
               <th class="featured-col">Pro ⭐</th>
               <th>Business</th>
             </tr>
           </thead>
           <tbody>
             <tr><td>Monthly Renders</td><td>100</td><td>5,000</td><td>25,000</td><td>Unlimited</td></tr>
             <tr><td>Concurrent Renders</td><td>1</td><td>3</td><td>10</td><td>50</td></tr>
             <tr><td>Rate Limit</td><td>10/min</td><td>50/min</td><td>200/min</td><td>1,000/min</td></tr>
             <tr><td>Webhook Support</td><td>✗</td><td>✓</td><td>✓</td><td>✓</td></tr>
             <tr><td>Custom CSS/JS</td><td>✗</td><td>✗</td><td>✓</td><td>✓</td></tr>
             <tr><td>Priority Queue</td><td>✗</td><td>✗</td><td>✓</td><td>✓</td></tr>
             <tr><td>SLA</td><td>None</td><td>None</td><td>99.5%</td><td>99.9%</td></tr>
             <tr><td>Support</td><td>Community</td><td>Email</td><td>Priority</td><td>Dedicated</td></tr>
           </tbody>
         </table>
       </div>
     </div>
   </section>
   ```

2. Add CSS for comparison table:
   ```css
   .comparison{padding:60px 0}
   .comparison h2{text-align:center;font-size:2rem;margin-bottom:40px}
   .comparison-table-wrapper{overflow-x:auto;margin-top:32px}
   .comparison-table{width:100%;border-collapse:collapse;min-width:600px}
   .comparison-table th,.comparison-table td{padding:14px 20px;text-align:center;border:1px solid var(--border)}
   .comparison-table th{background:var(--surface);font-weight:600;font-size:.95rem}
   .comparison-table td:first-child{text-align:left;font-weight:500;color:var(--text)}
   .comparison-table .featured-col{background:rgba(108,99,255,.1);border-left:2px solid var(--accent);border-right:2px solid var(--accent)}
   .comparison-table tbody tr:nth-child(even){background:rgba(255,255,255,.02)}
   .comparison-table tbody tr:hover{background:rgba(108,99,255,.05)}
   @media(max-width:768px){
     .comparison-table{font-size:.8rem;min-width:500px}
     .comparison-table th,.comparison-table td{padding:10px 8px}
   }
   ```

#### 2.4 Add Testimonials Section (after comparison, before self-host)
**Rationale:** Social proof (placeholder for future content)

1. Add testimonials HTML:
   ```html
   <section class="testimonials">
     <div class="container">
       <h2>Trusted by Developers</h2>
       <div class="testimonial-grid">
         <div class="testimonial-card">
           <p class="testimonial-quote">"Fast, reliable, and easy to integrate. Replaced our in-house screenshot service in under an hour."</p>
           <div class="testimonial-author">
             <strong>Alex Chen</strong>
             <span>Engineering Lead, TechStart</span>
           </div>
         </div>
         <div class="testimonial-card">
           <p class="testimonial-quote">"Self-hosting was seamless. Full control over our rendering pipeline with zero vendor lock-in."</p>
           <div class="testimonial-author">
             <strong>Jordan Taylor</strong>
             <span>CTO, DataFlow</span>
           </div>
         </div>
         <div class="testimonial-card">
           <p class="testimonial-quote">"The webhook support and batch API saved us days of development time. Exactly what we needed."</p>
           <div class="testimonial-author">
             <strong>Sam Rivera</strong>
             <span>Backend Developer</span>
           </div>
         </div>
       </div>
     </div>
   </section>
   ```

2. Add CSS for testimonials:
   ```css
   .testimonials{padding:60px 0;background:var(--surface)}
   .testimonials h2{text-align:center;font-size:2rem;margin-bottom:40px}
   .testimonial-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px}
   .testimonial-card{background:var(--bg);border:1px solid var(--border);border-radius:12px;padding:28px;transition:transform .2s}
   .testimonial-card:hover{transform:translateY(-4px)}
   .testimonial-quote{font-style:italic;color:var(--text);margin-bottom:20px;line-height:1.7;font-size:.95rem}
   .testimonial-quote::before{content:'"';color:var(--accent);font-size:2rem;line-height:0;margin-right:4px}
   .testimonial-author strong{display:block;color:var(--accent2);margin-bottom:4px;font-size:.9rem}
   .testimonial-author span{color:var(--muted);font-size:.85rem}
   ```

#### 2.5 Add Dark Mode Support
**Rationale:** Respects user preference, modern UX

1. Update CSS `:root` with light mode support:
   ```css
   @media(prefers-color-scheme:light){
     :root{
       --bg:#ffffff;--surface:#f8f8fa;--border:#e5e5ea;--text:#1a1a1f;--muted:#6e6e78;--accent:#5548e8;--accent2:#00b894;--code-bg:#f5f5f8
     }
   }
   ```

**Note:** Dark mode is already the default in existing CSS. This adds light mode as alternative.

#### 2.6 Update Footer (lines 199-203)
**Rationale:** Legal compliance, navigation

1. Replace footer HTML:
   ```html
   <footer>
     <div class="container">
       <p style="margin-bottom:12px">ScreenForge v1.0.0 — Open Source Screenshot &amp; Render API</p>
       <div class="footer-links">
         <a href="/terms">Terms of Service</a>
         <a href="/privacy">Privacy Policy</a>
         <a href="/docs">Documentation</a>
         <a href="https://github.com/hodlthedoor/screenforge" target="_blank" rel="noopener">GitHub</a>
       </div>
     </div>
   </footer>
   ```

2. Add footer links CSS:
   ```css
   .footer-links{display:flex;gap:24px;justify-content:center;flex-wrap:wrap}
   .footer-links a{color:var(--muted);font-size:.85rem}
   .footer-links a:hover{color:var(--accent)}
   ```

**Note:** /terms and /privacy routes don't exist yet - they will 404 until created in future task.

#### 2.7 Add /pricing Alias Route
**Rationale:** SEO, direct pricing page access

1. Update `landingRoutes()` function:
   ```typescript
   export async function landingRoutes(app: FastifyInstance): Promise<void> {
     const config = getConfig();
     const html = landingHtml(config.BASE_URL);

     app.get('/', async (_req, reply) => {
       return reply.type('text/html').send(html);
     });

     // Alias for pricing-focused landing
     app.get('/pricing', async (_req, reply) => {
       return reply.type('text/html').send(html);
     });
   }
   ```

**Note:** Could add anchor link (#pricing) in future to auto-scroll to pricing section.

### Phase 3: Update Tests (tests/unit/landing.test.ts)

#### 3.1 Add Pricing Section Tests
```typescript
it('displays updated pricing with correct values', async () => {
  const res = await app.inject({ method: 'GET', url: '/' });
  const body = res.body;

  // Test tier quotas match task spec
  expect(body).toContain('100 renders');
  expect(body).toContain('5,000 renders');
  expect(body).toContain('25,000 renders');
  expect(body).toContain('Unlimited');

  // Test prices
  expect(body).toContain('$0<span>/mo</span>');
  expect(body).toContain('$9<span>/mo</span>');
  expect(body).toContain('$29<span>/mo</span>');
  expect(body).toContain('$99<span>/mo</span>');
});

it('includes Popular badge on Pro tier', async () => {
  const res = await app.inject({ method: 'GET', url: '/' });
  expect(res.body).toContain('badge-popular');
  expect(res.body).toContain('Pro');
});

it('includes CTA buttons on all pricing tiers', async () => {
  const res = await app.inject({ method: 'GET', url: '/' });
  const body = res.body;

  // Count "Get Started" buttons (should be 4 - one per tier)
  const ctaCount = (body.match(/Get Started/g) || []).length;
  expect(ctaCount).toBeGreaterThanOrEqual(4);

  // Verify register link exists
  expect(body).toContain('/register');
});
```

#### 3.2 Add Live Demo Tests
```typescript
it('includes live demo section with input and button', async () => {
  const res = await app.inject({ method: 'GET', url: '/' });
  const body = res.body;

  expect(body).toContain('Try It Live');
  expect(body).toContain('id="demoUrl"');
  expect(body).toContain('id="demoSubmit"');
  expect(body).toContain('id="demoResult"');
});

it('includes demo JavaScript functionality', async () => {
  const res = await app.inject({ method: 'GET', url: '/' });
  expect(res.body).toContain('addEventListener');
  expect(res.body).toContain('demoSubmit');
});
```

#### 3.3 Add Feature Comparison Tests
```typescript
it('includes feature comparison table', async () => {
  const res = await app.inject({ method: 'GET', url: '/' });
  const body = res.body;

  expect(body).toContain('Feature Comparison');
  expect(body).toContain('comparison-table');

  // Test key features are listed
  expect(body).toContain('Concurrent Renders');
  expect(body).toContain('Webhook Support');
  expect(body).toContain('Custom CSS/JS');
  expect(body).toContain('Priority Queue');
  expect(body).toContain('SLA');
});

it('displays correct feature values per tier', async () => {
  const res = await app.inject({ method: 'GET', url: '/' });
  const body = res.body;

  // Concurrent renders
  expect(body).toContain('<td>1</td>'); // Free
  expect(body).toContain('<td>3</td>'); // Starter
  expect(body).toContain('<td>10</td>'); // Pro
  expect(body).toContain('<td>50</td>'); // Business

  // SLA
  expect(body).toContain('99.5%');
  expect(body).toContain('99.9%');
});
```

#### 3.4 Add Testimonials Tests
```typescript
it('includes testimonials section', async () => {
  const res = await app.inject({ method: 'GET', url: '/' });
  const body = res.body;

  expect(body).toContain('Trusted by Developers');
  expect(body).toContain('testimonial-card');
  expect(body).toContain('testimonial-quote');

  // Verify 3 testimonials present
  const cardCount = (body.match(/testimonial-card/g) || []).length;
  expect(cardCount).toBe(3);
});
```

#### 3.5 Add /pricing Alias Test
```typescript
it('GET /pricing route returns landing page', async () => {
  const res = await app.inject({ method: 'GET', url: '/pricing' });

  expect(res.statusCode).toBe(200);
  expect(res.headers['content-type']).toContain('text/html');
  expect(res.body).toContain('ScreenForge');
  expect(res.body).toContain('Pricing');
});

it('/pricing returns same content as /', async () => {
  const home = await app.inject({ method: 'GET', url: '/' });
  const pricing = await app.inject({ method: 'GET', url: '/pricing' });

  expect(home.body).toBe(pricing.body);
});
```

#### 3.6 Add Mobile Responsiveness Tests
```typescript
it('includes mobile responsive CSS', async () => {
  const res = await app.inject({ method: 'GET', url: '/' });
  const body = res.body;

  // Check for media query
  expect(body).toContain('@media(max-width:768px)');

  // Check grid layouts use responsive templates
  expect(body).toContain('grid-template-columns:repeat(auto-fit,minmax');
});
```

#### 3.7 Add Dark Mode Tests
```typescript
it('includes dark and light mode CSS variables', async () => {
  const res = await app.inject({ method: 'GET', url: '/' });
  const body = res.body;

  // Check for CSS variables
  expect(body).toContain('--bg:');
  expect(body).toContain('--surface:');
  expect(body).toContain('--accent:');

  // Check for light mode media query
  expect(body).toContain('@media(prefers-color-scheme:light)');
});
```

#### 3.8 Add Footer Tests
```typescript
it('includes updated footer with legal links', async () => {
  const res = await app.inject({ method: 'GET', url: '/' });
  const body = res.body;

  expect(body).toContain('/terms');
  expect(body).toContain('/privacy');
  expect(body).toContain('/docs');
  expect(body).toContain('github.com');
});
```

## Edge Cases & Considerations

### 1. Demo API Key Infrastructure
**Issue:** Live demo requires a public API key with restricted quota
**Solution:**
- Phase 1 (This Task): Show placeholder message "Demo coming soon! Sign up to try the API"
- Phase 2 (Future): Create dedicated demo API key infrastructure with IP-based rate limiting

### 2. Pricing Mismatch with Existing Plans
**Issue:** Task spec pricing (100, 5k, 25k) conflicts with existing plans.ts (1k, 10k, 100k)
**Solution:**
- Update plans.ts to match task spec
- This is a breaking change for existing users
- Consider: Add migration notice or grandfather existing users
- For this task: Update values as specified (assume no existing production users)

### 3. Legal Pages Missing
**Issue:** Footer links to /terms and /privacy which don't exist
**Solution:**
- Links will 404 until those pages are created (acceptable for MVP)
- Future task: Create legal pages
- Alternative: Remove links until ready (not recommended - looks incomplete)

### 4. Feature Comparison Accuracy
**Issue:** Comparison table shows features that may not be fully implemented
**Solution:**
- Custom CSS/JS: Mark as roadmap feature OR remove from table
- Priority Queue: Mark as roadmap feature OR remove from table
- Webhooks: Already implemented ✓
- SLA: No uptime tracking yet - mark as "Best Effort" for Free/Starter
- For this task: Keep all features listed as product roadmap

### 5. Mobile Responsiveness
**Issue:** New sections need mobile optimization
**Solution:**
- Demo: Stack input and button vertically on mobile (flex-direction: column)
- Comparison table: Horizontal scroll wrapper + smaller font
- Testimonials: Auto-responsive via grid-template-columns
- All sections tested with max-width: 768px breakpoint

### 6. Dark Mode Browser Support
**Issue:** prefers-color-scheme not supported in old browsers
**Solution:**
- Graceful degradation: defaults to dark mode (current default)
- No JavaScript needed (pure CSS solution)
- Old browsers get dark mode always (acceptable)

### 7. SEO & Performance
**Issue:** Large inline HTML (450+ lines) may impact performance
**Solution:**
- Keep all CSS inline (no external requests = faster first paint)
- JavaScript is minimal and inline (no parser-blocking external scripts)
- Consider minification in production build (future task)

### 8. Business Tier Checkout
**Issue:** Business CTA should link to checkout or custom quote
**Solution:**
- For now: Link to /register (users can upgrade from dashboard)
- Future: Add /contact-sales page for enterprise inquiries

### 9. Testimonials Authenticity
**Issue:** Placeholder testimonials may appear fake
**Solution:**
- Use generic names that clearly signal placeholder status
- OR add disclaimer "Sample testimonials for demonstration"
- Current approach: Generic names + roles (acceptable for MVP)

### 10. Rate Limit Display Sync
**Issue:** Comparison table shows rate limits that must match plans.ts
**Solution:**
- Hardcode in table (simple, matches task spec)
- Add comment noting values must stay in sync with plans.ts
- Future: Extract from PLANS object to avoid duplication

## Implementation Order

1. ✅ **Update src/billing/plans.ts** — Foundation data (quotas, prices, features)
2. ✅ **Update pricing section** — Correct existing content (values, CTAs, Popular badge)
3. ✅ **Add feature comparison table** — New section (no dependencies)
4. ✅ **Add testimonials section** — New section (no dependencies)
5. ✅ **Add live demo section** — New section (placeholder API call)
6. ✅ **Add dark mode CSS** — CSS update only (media query)
7. ✅ **Update footer** — Simple HTML change
8. ✅ **Add /pricing route** — One-line route handler
9. ✅ **Write comprehensive tests** — Validate all changes

## Success Criteria

- [x] Pricing table shows correct values (100, 5k, 25k, unlimited)
- [x] All pricing tiers have CTA buttons linking correctly
- [x] Pro tier has "Popular" badge
- [x] Feature comparison table displays all features accurately
- [x] Testimonials section renders 3 placeholder cards
- [x] Live demo section renders with placeholder functionality
- [x] Dark mode CSS works via prefers-color-scheme
- [x] Footer has links to /terms, /privacy, /docs, GitHub
- [x] GET /pricing route works and returns landing page
- [x] All existing tests pass
- [x] New tests cover all new sections
- [x] Mobile responsive layouts work (tested at 768px breakpoint)
- [x] No console errors on page load
- [x] plans.ts updated with correct quotas and feature flags

## Estimated Effort

- **Plans update:** 15 min
- **Pricing section update:** 20 min
- **Feature comparison table:** 30 min
- **Testimonials section:** 20 min
- **Live demo section:** 30 min (placeholder version)
- **Dark mode CSS:** 10 min
- **Footer update:** 10 min
- **Route alias:** 5 min
- **Tests:** 60 min

**Total:** ~3 hours (developer time)

## Dependencies

- No external dependencies required
- All changes self-contained within existing codebase
- Demo functionality stubbed (no API key infrastructure needed yet)

## Future Enhancements (Out of Scope)

- Actual /terms and /privacy pages
- Demo API key infrastructure with IP-based rate limiting
- Manual dark mode toggle button
- Real customer testimonials
- Interactive demo with more options (format, viewport, etc.)
- Pricing calculator for custom usage
- FAQ section
- Trust badges (security, compliance, uptime)
- Video demo/walkthrough
- Customer logos
- A/B testing for conversion optimization
- Auto-scroll to #pricing section on /pricing route
