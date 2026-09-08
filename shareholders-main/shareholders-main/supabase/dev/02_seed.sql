-- ============================================================================
-- Stockholder Portal — dev seed data
-- ============================================================================
-- Entirely fictional. Run after 01_schema.sql.
--
-- Log in with any of these National IDs and the TEST_OTP_CODE (default 123456)
-- once TWILIO_ENV=test is set on the dev project's edge functions:
--
--   1000000001  Ahmed Al-Otaibi   -- has transactions, dividends, certificate
--   1000000002  Sara Al-Harbi     -- smaller holding
--   1000000003  Khalid Al-Zahrani -- INACTIVE: should be rejected at login
-- ============================================================================

-- --- stockholders ----------------------------------------------------------
insert into public.stockholders (
  id, national_id, full_name_ar, full_name_en, email, phone_number,
  birth_date_hijri, birth_date_gregorian, birth_place,
  address_building, address_street, address_district, address_city,
  address_postal_code, address_additional_number, is_active
) values
  (
    '11111111-1111-1111-1111-111111111111',
    '1000000001',
    'أحمد بن محمد العتيبي', 'Ahmed Mohammed Al-Otaibi',
    'ahmed.dev@example.com', '+966500000001',
    '1400-05-12', '1980-03-29', 'الرياض',
    '2453', 'طريق الملك فهد', 'العليا', 'الرياض', '12211', '6789',
    true
  ),
  (
    '22222222-2222-2222-2222-222222222222',
    '1000000002',
    'سارة بنت عبدالله الحربي', 'Sara Abdullah Al-Harbi',
    'sara.dev@example.com', '+966500000002',
    '1410-09-03', '1990-03-25', 'جدة',
    '117', 'شارع الأمير سلطان', 'الروضة', 'جدة', '23434', '1122',
    true
  ),
  (
    '33333333-3333-3333-3333-333333333333',
    '1000000003',
    'خالد بن سعيد الزهراني', 'Khalid Saeed Al-Zahrani',
    'khalid.dev@example.com', '+966500000003',
    '1395-01-20', '1975-02-01', 'أبها',
    '80', 'شارع الملك خالد', 'المنسك', 'أبها', '62521', '3344',
    false                                   -- inactive: login must be refused
  )
on conflict (national_id) do nothing;

-- --- transactions ----------------------------------------------------------
-- Ahmed: 500 + 250 - 100 = 650 shares
insert into public.stockholder_transactions (
  stockholder_id, transaction_type, shares, price_per_share, total_amount,
  transaction_date, notes
) values
  ('11111111-1111-1111-1111-111111111111', 'purchase', 500, 100.00,  50000.00, '2019-04-15', 'الاكتتاب التأسيسي'),
  ('11111111-1111-1111-1111-111111111111', 'purchase', 250, 120.00,  30000.00, '2021-08-02', 'شراء إضافي'),
  ('11111111-1111-1111-1111-111111111111', 'sell',     100, 135.00,  13500.00, '2023-11-20', 'بيع جزئي'),
  ('22222222-2222-2222-2222-222222222222', 'purchase', 200, 100.00,  20000.00, '2020-01-10', 'الاكتتاب التأسيسي'),
  ('22222222-2222-2222-2222-222222222222', 'purchase',  75, 128.00,   9600.00, '2024-05-06', null);

-- --- yearly dividends ------------------------------------------------------
insert into public.yearly_dividends (stockholder_id, year, amount, notes) values
  ('11111111-1111-1111-1111-111111111111', 2022,  6500.00, null),
  ('11111111-1111-1111-1111-111111111111', 2023,  7150.00, null),
  ('11111111-1111-1111-1111-111111111111', 2024,  8450.00, 'أرباح استثنائية'),
  ('22222222-2222-2222-2222-222222222222', 2023,  2000.00, null),
  ('22222222-2222-2222-2222-222222222222', 2024,  2750.00, null)
on conflict (stockholder_id, year) do nothing;

-- --- stock certificates ----------------------------------------------------
-- storage_path points at an object that does not exist yet; the portal will
-- list the row and fall back to the raw file_url when signing fails. Upload a
-- PDF to the stock-certificates bucket at this path to exercise the viewer.
insert into public.stock_certificates (
  stockholder_id, file_url, storage_path, file_name
) values
  (
    '11111111-1111-1111-1111-111111111111',
    'https://example.invalid/dev-placeholder.pdf',
    '11111111-1111-1111-1111-111111111111/certificate-2019.pdf',
    'certificate-2019.pdf'
  );

-- --- announcements ---------------------------------------------------------
insert into public.announcements (
  title_ar, title_en, body_ar, body_en, is_published, published_at
) values
  (
    'الجمعية العمومية السنوية 2025',
    'Annual General Meeting 2025',
    '<p>تدعو الجمعية جميع المساهمين لحضور الاجتماع السنوي.</p>',
    '<p>All shareholders are invited to attend the annual meeting.</p>',
    true, now() - interval '3 days'
  ),
  (
    'توزيع أرباح عام 2024',
    'Dividend Distribution for 2024',
    '<p>تم اعتماد توزيع الأرباح للسنة المالية 2024.</p>',
    '<p>The dividend distribution for fiscal year 2024 has been approved.</p>',
    true, now() - interval '20 days'
  ),
  (
    'مسودة غير منشورة',
    'Unpublished Draft',
    '<p>يجب ألا تظهر هذه في البوابة.</p>',
    '<p>This must not appear in the portal.</p>',
    false, null
  );

-- --- feedback questions ----------------------------------------------------
insert into public.feedback_questions (
  question_ar, question_en, question_type, category_ar, category_en, sort_order, is_active
) values
  ('ما مدى رضاك عن سهولة استخدام البوابة؟', 'How satisfied are you with the portal''s ease of use?', 'rating', 'التجربة', 'Experience', 1, true),
  ('ما مدى وضوح معلومات الأسهم والأرباح؟',  'How clear is the shares and dividends information?',  'rating', 'المحتوى', 'Content',    2, true),
  ('ما مدى رضاك عن سرعة الرد على استفساراتك؟', 'How satisfied are you with our response times?',    'rating', 'الدعم',   'Support',    3, true),
  ('هل لديك أي اقتراحات لتحسين البوابة؟',    'Do you have any suggestions to improve the portal?',  'text',   'اقتراحات', 'Suggestions', 4, true);
