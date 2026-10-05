import { createClient } from 'npm:@supabase/supabase-js@2.117.2';

const allowedOrigins = new Set([
  'https://linkorasolution.com',
  'https://www.linkorasolution.com',
  'http://localhost:8765',
  'http://127.0.0.1:8765',
]);
const maxResumeBytes = 8 * 1024 * 1024;
const maxRequestBytes = maxResumeBytes + 1024 * 1024;
const types: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

function headers(origin: string) {
  const result: Record<string, string> = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, apikey, authorization, x-client-info',
  };
  if (allowedOrigins.has(origin)) result['Access-Control-Allow-Origin'] = origin;
  return result;
}
function json(origin: string, data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: headers(origin) });
}
class InputError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
function value(form: FormData, name: string, max: number, required = false) {
  const raw = form.get(name);
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (text.length > max || (required && !text)) throw new InputError('Please check the form fields.');
  return text;
}
function optionalUrl(form: FormData, name: string, linkedin = false) {
  const text = value(form, name, 500);
  if (!text) return null;
  let parsed;
  try { parsed = new URL(text); } catch { throw new InputError('Enter a valid HTTPS URL.'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password ||
      (linkedin && !(/(^|\.)linkedin\.com$/i.test(parsed.hostname)))) {
    throw new InputError('Enter a valid HTTPS URL.');
  }
  return parsed.href;
}
function serviceClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const modern = Deno.env.get('SUPABASE_SECRET_KEYS');
  let secret;
  try { secret = modern && JSON.parse(modern).default; } catch { /* Legacy project fallback below. */ }
  secret = secret || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !secret) throw new Error('Missing server-side Supabase credentials');
  return createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
}
async function validateResume(file: FormDataEntryValue | null) {
  if (!(file instanceof File) || file.size === 0 || file.size > maxResumeBytes) {
    throw new InputError('Attach a PDF, DOC or DOCX CV under 8 MB.');
  }
  const ext = file.name.toLowerCase().split('.').pop();
  if (!ext || !Object.hasOwn(types, ext) || file.type !== types[ext]) {
    throw new InputError('Attach a PDF, DOC or DOCX CV under 8 MB.');
  }
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const pdf = ext === 'pdf' && [37, 80, 68, 70, 45].every((n, i) => bytes[i] === n);
  const doc = ext === 'doc' && [208, 207, 17, 224, 161, 177, 26, 225].every((n, i) => bytes[i] === n);
  const docx = ext === 'docx' && [80, 75, 3, 4].every((n, i) => bytes[i] === n);
  if (!pdf && !doc && !docx) throw new InputError('The CV file does not match its type.');
  return ext;
}

Deno.serve(async (request) => {
  const origin = request.headers.get('origin') || '';
  if (origin && !allowedOrigins.has(origin)) return json(origin, { error: 'Origin not allowed.' }, 403);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: headers(origin) });
  if (request.method !== 'POST') return json(origin, { error: 'Method not allowed.' }, 405);
  if (!request.headers.get('content-type')?.startsWith('multipart/form-data')) {
    return json(origin, { error: 'Submit the application form with a CV.' }, 415);
  }
  const length = Number(request.headers.get('content-length'));
  if (Number.isFinite(length) && length > maxRequestBytes) {
    return json(origin, { error: 'The application is too large.' }, 413);
  }

  let uploadedPath = '';
  let service: ReturnType<typeof createClient> | undefined;
  let rpcAttempted = false;
  try {
    const form = await request.formData();
    if (value(form, 'website_confirm', 200)) throw new InputError('Invalid submission.');
    const isGeneral = value(form, 'submission_type', 30) === 'general_resume';
    const jobId = isGeneral ? '' : value(form, 'job_id', 36, true);
    if (!isGeneral && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) {
      throw new InputError('This job is unavailable.');
    }
    const fullName = value(form, 'full_name', 160, true);
    if (fullName.length < 2) throw new InputError('Enter your full name.');
    const email = value(form, 'email', 320, true).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new InputError('Enter a valid email.');
    const phone = value(form, 'phone', 40, true);
    if (phone.length < 7) throw new InputError('Enter a valid phone number.');
    const city = value(form, 'city', 120, !isGeneral);
    const country = value(form, 'country', 120, !isGeneral);
    if (!isGeneral && (city.length < 2 || country.length < 2)) throw new InputError('Enter your city and country.');
    const linkedin = optionalUrl(form, 'linkedin_url', true);
    if (!isGeneral && !linkedin) throw new InputError('Enter your LinkedIn profile URL.');
    const portfolio = optionalUrl(form, 'portfolio_url');
    const experienceText = value(form, 'years_experience', 5, !isGeneral);
    if ((experienceText || !isGeneral) && (!/^\d{1,2}(?:\.\d)?$/.test(experienceText) || Number(experienceText) > 60)) {
      throw new InputError('Enter years of experience between 0 and 60.');
    }
    const currentRole = value(form, 'current_role', 160, !isGeneral);
    if (!isGeneral && currentRole.length < 2) throw new InputError('Enter your current role.');
    const currentCompany = isGeneral ? '' : value(form, 'current_company', 160);
    const expectedSalary = isGeneral ? '' : value(form, 'expected_salary', 100);
    const noticePeriod = isGeneral ? '' : value(form, 'notice_period', 120, true);
    if (!isGeneral && noticePeriod.length < 2) throw new InputError('Enter your notice period.');
    const coverLetter = isGeneral ? '' : value(form, 'cover_letter', 10000, true);
    if (!isGeneral && coverLetter.length < 20) throw new InputError('Your cover letter needs at least 20 characters.');
    const primarySkill = isGeneral ? value(form, 'primary_skill', 120, true) : '';
    if (isGeneral && primarySkill.length < 2) throw new InputError('Enter your primary skill.');
    const message = isGeneral ? value(form, 'message', 5000) : '';
    if (value(form, 'consent', 10) !== 'yes') throw new InputError('Please consent to recruitment data processing.');
    const file = form.get('resume');
    const extension = await validateResume(file);

    service = serviceClient();
    if (isGeneral) {
      uploadedPath = 'general/' + crypto.randomUUID() + '.' + extension;
      const upload = await service.storage.from('career-resumes').upload(uploadedPath, file, {
        contentType: types[extension], upsert: false,
      });
      if (upload.error) throw upload.error;
      rpcAttempted = true;
      const submitted = await service.rpc('career_submit_resume', {
        p_full_name: fullName, p_email: email, p_phone: phone, p_primary_skill: primarySkill,
        p_city: city || null, p_country: country || null, p_current_role: currentRole || null,
        p_years_experience: experienceText ? Number(experienceText) : null,
        p_linkedin_url: linkedin, p_portfolio_url: portfolio, p_message: message,
        p_resume_path: uploadedPath, p_consent: true,
      });
      if (submitted.error) throw submitted.error;
      return json(origin, { success: true, message: 'Thank you for sharing your profile with LINKORA SOLUTIONS. Your resume has been received for future opportunities.' }, 201);
    }
    const job = await service.from('career_jobs').select('id,status,closes_at').eq('id', jobId).maybeSingle();
    if (job.error) throw job.error;
    if (!job.data || job.data.status !== 'open' ||
        (job.data.closes_at && new Date(job.data.closes_at).getTime() <= Date.now())) {
      throw new InputError('This job is no longer accepting applications.', 410);
    }

    uploadedPath = jobId + '/' + crypto.randomUUID() + '.' + extension;
    const upload = await service.storage.from('career-resumes').upload(uploadedPath, file, {
      contentType: types[extension], upsert: false,
    });
    if (upload.error) throw upload.error;

    rpcAttempted = true;
    const submitted = await service.rpc('career_submit_application', {
      p_job_id: jobId, p_full_name: fullName, p_email: email, p_phone: phone,
      p_city: city, p_country: country, p_linkedin_url: linkedin,
      p_portfolio_url: portfolio, p_years_experience: Number(experienceText),
      p_current_company: currentCompany || null, p_current_role: currentRole,
      p_expected_salary: expectedSalary || null, p_notice_period: noticePeriod,
      p_cover_letter: coverLetter, p_resume_path: uploadedPath, p_consent: true,
    });
    if (submitted.error) throw submitted.error;
    return json(origin, { success: true, message: 'Application received. Thank you for applying.' }, 201);
  } catch (error) {
    const failure = error as { code?: string; message?: string };
    if (uploadedPath && service) {
      // A network failure after commit must not delete an attached CV.
      try {
        const existing = rpcAttempted
          ? await service.from(uploadedPath.startsWith('general/') ? 'career_resume_submissions' : 'career_applications').select('id').eq('resume_path', uploadedPath).maybeSingle()
          : { data: null, error: null };
        if (existing.data) return json(origin, { success: true, message: uploadedPath.startsWith('general/') ? 'Thank you for sharing your profile with LINKORA SOLUTIONS. Your resume has been received for future opportunities.' : 'Application received. Thank you for applying.' }, 201);
        if (!existing.error) await service.storage.from('career-resumes').remove([uploadedPath]);
      } catch { /* The private file is retained if commit status cannot be verified. */ }
    }
    if (failure.code === '23505') return json(origin, { error: uploadedPath.startsWith('general/') ? 'You have already sent a resume recently. Please wait before trying again.' : 'You have already applied for this job.' }, 409);
    if (error instanceof InputError) return json(origin, { error: error.message }, error.status);
    if (failure.code === '22023') return json(origin, { error: 'This job is no longer accepting applications.' }, 410);
    console.error('Career application failed', failure.code || 'unknown');
    return json(origin, { error: 'We could not submit your application. Please try again.' }, 500);
  }
});
