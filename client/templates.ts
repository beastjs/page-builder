export const templates = {
  blank: 'main.page\n  h1 A new page\n  p Make something worth visiting.\n',
  landing: `main.page
  nav.page-nav
    a.brand(href="/") Studio
    a(href="#contact") Let’s talk ↗
  section.hero
    p.eyebrow MADE WITH BEAST
    h1 Your next big idea starts here.
    p.description A little imagination. A space to build. Everything you need to make something great.
    a.page-button(href="#features") Explore what’s possible →
  section.features#features
    article.feature
      span 01
      h2 Start with a spark
      p Turn a fresh idea into your next favorite project.
    article.feature
      span 02
      h2 Make it yours
      p Build with small pieces that fit beautifully together.
    article.feature
      span 03
      h2 Put it out there
      p Good things are made to be shared with the world.
  footer#contact
    p Have something in mind?
    a(href="mailto:hello@example.com") Let’s make it happen ↗

style
  .page { max-width: 1080px; margin: auto; padding: 40px; font-family: system-ui, sans-serif; color: #222; }
  .page-nav { display: flex; justify-content: space-between; gap: 24px; align-items: center; }
  .page a { color: inherit; text-decoration: none; }
  .brand { font-size: 22px; font-weight: 650; }
  .hero { padding: 100px 0 80px; max-width: 750px; }
  .eyebrow { color: #777; font-size: 11px; letter-spacing: .18em; }
  .hero h1 { font-size: clamp(40px, 6vw, 72px); letter-spacing: -.055em; line-height: 1.05; margin: 28px 0; }
  .description { max-width: 470px; color: #777; line-height: 1.7; }
  .page-button { display: inline-block; margin-top: 24px; background: #edf3ff; padding: 16px 24px; border-radius: 12px; }
  .features { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 36px; padding: 40px 0 80px; border-top: 1px solid #eee; }
  .feature span { color: #999; font-size: 12px; }
  .feature h2 { font-size: 20px; font-weight: 550; letter-spacing: -.03em; }
  .feature p, footer p { color: #777; line-height: 1.7; }
  .page footer { border-top: 1px solid #eee; padding: 32px 0; }
`,
}

export const sections: Record<string, string> = {
  Hero: '\n  section.hero\n    p.eyebrow INTRODUCING\n    h1 Build something remarkable.\n    p.description Your idea, brought to life.\n',
  Features: '\n  section.features\n    article.feature\n      h2 Made for you\n      p Thoughtful details. Endless possibilities.\n',
  'Call to action': '\n  section\n    h2 Ready to get started?\n    a.page-button(href="/contact") Let’s talk →\n',
}
