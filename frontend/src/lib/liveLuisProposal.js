/** Live Corrales & Co. proposal used when production has no Luis record yet. */

export function luisLiveDraft() {
  return {
    title: "Corrales & Co.",
    client: {
      contact_name: "Luis Corrales",
      email: "luis@corrales.co",
      phone: "+1 305 555 2424",
    },
    schedule: {
      session_date: "2026-08-24",
      arrival_time: "10:00",
      setup_time: "10:30",
      shoot_time: "11:00",
      wrap_time: "14:00",
    },
    vision: {
      brand_description:
        "Corrales & Co. is a wealth management and tax advisory firm providing strategic financial guidance to founders, entrepreneurs, business owners, and individuals focused on building, protecting, and growing long-term wealth.\n\nThe content strategy will position Luis Corrales as the trusted face behind the company — combining financial expertise, entrepreneurship, leadership, lifestyle, and real-world business insight.",
      content_goals:
        "Build a recognizable and trusted personal brand around Luis Corrales that consistently generates attention for Corrales & Co. Establish Luis as an authority in wealth management, tax strategy, entrepreneurship, and financial decision-making, and humanize the founder behind the company.\n\nEducate business owners through simple, valuable financial content, increase brand awareness and credibility, and create consistent content for Instagram, LinkedIn, TikTok, and other short-form platforms.\n\nTurn social attention into consultation and client opportunities. Maintain a minimum of 4 strong posts per week. Include 1 monthly strategy + performance call.",
      target_audience:
        "Entrepreneurs, founders, executives, professionals, real estate investors, high-income earners, and growing business owners.\n\nThey want smarter strategies for managing taxes, building wealth, protecting assets, and making long-term financial decisions.",
      desired_energy:
        "Confident, intelligent, aspirational, and trustworthy — modern financial authority without feeling overly corporate.\n\nPolished enough for wealth management.\nPersonal enough for social media.",
    },
    content_items: [
      {
        type: "Authority Reels",
        quantity: "10 videos",
        energy: "Confident, insightful and direct — Luis speaking as the expert in the room.",
        visual_style:
          "Clean cinematic lighting, professional environments, multiple compositions, subtitles, branded graphics and strategic B-roll. Topics include wealth-building strategies, tax mistakes entrepreneurs make, business-owner financial planning, investing principles, cash-flow management, founder finances, asset protection, financial myths, common client questions, and high-income financial decisions.",
        description: "Expert-facing reels that establish Luis as the authority in the room.",
        deliverables: "10 edited vertical reels with subtitles and branded graphics",
      },
      {
        type: "Founder / Lifestyle Reels",
        quantity: "5 videos",
        energy: "Aspirational, authentic and personal — showing the person behind the expertise.",
        visual_style:
          "Cinematic handheld and stabilized footage in motion: office, meetings, properties, walking shots, phone calls, business interactions and lifestyle environments.",
        description: "Personal founder footage that humanizes Luis behind Corrales & Co.",
        deliverables: "5 edited founder and lifestyle reels",
      },
      {
        type: "Brand Photography",
        quantity: "40+ edited photos",
        energy: "Premium, credible and timeless",
        visual_style:
          "Executive portraits, environmental portraits, office lifestyle, meetings, candid business moments, detail shots and social-media ready imagery for social, website, LinkedIn, press, marketing, and company materials.",
        description: "An ongoing visual library for social, web, and company materials.",
        deliverables: "40+ edited photos per month",
      },
    ],
    pricing: {
      currency: "USD",
      session_rate: 3850,
      deposit_percent: 50,
      deliverables: "15",
      turnaround: "10–15 business days",
      line_items: [
        {
          description: "Creative direction and studio production",
          quantity: 1,
          unit_price: 3850,
        },
      ],
    },
    share: {
      subject: "Your Studio 7 proposal — Corrales & Co.",
      message: "Luis — here’s what we put together for you.",
      expires_days: 30,
    },
  };
}

export function isLuisProposal(proposal) {
  return /luis\s+corrales/i.test(proposal?.client?.contact_name || proposal?.client_name || "");
}
