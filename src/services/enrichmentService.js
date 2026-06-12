'use strict';

const axios = require('axios');
const supabase = require('../db');

const GOOGLE_SEARCH_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const IGNORED_DOMAINS = [
  'google.com',
  'google.com.br',
  'maps.google',
  'goo.gl',
  'youtube.com',
  'facebook.com',
  'twitter.com',
  'linkedin.com',
  'yelp.com',
  'tripadvisor.com',
];

function extractLinks(html) {
  const links = [];
  const regex = /href="(https?:\/\/[^"]+)"/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    links.push(match[1]);
  }
  return links;
}

function extractEmail(text) {
  const match = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  return match ? match[0] : null;
}

function isIgnoredDomain(url) {
  return IGNORED_DOMAINS.some((domain) => url.includes(domain));
}

function extractInstagram(links) {
  return links.find((url) => url.includes('instagram.com')) || null;
}

function extractWebsite(links) {
  return links.find((url) => !isIgnoredDomain(url)) || null;
}

async function enrichLead(leadId) {
  const { data: lead, error: leadError } = await supabase
    .from('leads')
    .select('*')
    .eq('id', leadId)
    .single();

  if (leadError) throw new Error(`enrichLead: ${leadError.message}`);
  if (!lead) throw new Error(`enrichLead: lead ${leadId} not found`);

  const query = `${lead.nome} ${lead.cidade || ''} site`.trim();
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=10`;

  let website = null;
  let email = null;
  let instagram = null;

  try {
    const searchResponse = await axios.get(searchUrl, {
      headers: {
        'User-Agent': GOOGLE_SEARCH_UA,
        Accept: 'text/html',
        'Accept-Language': 'pt-BR,pt;q=0.9',
      },
      timeout: 10000,
    });

    const html = searchResponse.data;
    const links = extractLinks(html);

    website = extractWebsite(links);
    instagram = extractInstagram(links);
    email = extractEmail(html);

    // Try to scrape the website for email if not found in search results
    if (!email && website) {
      try {
        const siteResponse = await axios.get(website, {
          headers: { 'User-Agent': GOOGLE_SEARCH_UA },
          timeout: 8000,
        });
        email = extractEmail(siteResponse.data);
        if (!instagram) {
          const siteLinks = extractLinks(siteResponse.data);
          instagram = extractInstagram(siteLinks);
        }
      } catch (_err) {
        // silently ignore page fetch errors
      }
    }
  } catch (err) {
    console.error(`[enrichmentService] Google search failed for lead ${leadId}:`, err.message);
  }

  const updates = {};
  if (website) updates.website = website;
  if (email) updates.email = email;
  if (instagram) updates.instagram = instagram;

  if (Object.keys(updates).length > 0) {
    const { error: updateError } = await supabase
      .from('leads')
      .update(updates)
      .eq('id', leadId);

    if (updateError) throw new Error(`enrichLead update: ${updateError.message}`);
  }

  return { website, email, instagram };
}

module.exports = { enrichLead };
