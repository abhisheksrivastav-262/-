-- Close global CMS/storage management to non-Super-Admin roles.
-- Keep this migration additive and safe to re-run; no application data is removed.
drop policy if exists admin_projects_manage on public.projects;
drop policy if exists admin_news_manage on public.news;
drop policy if exists admin_events_manage on public.events;
drop policy if exists admin_albums_manage on public.photo_albums;
drop policy if exists admin_images_manage on public.gallery_images;
drop policy if exists admin_videos_manage on public.videos;
drop policy if exists admin_awards_manage on public.awards;
drop policy if exists admin_reports_manage on public.annual_audit_reports;
drop policy if exists admin_team_manage on public.management_team;
drop policy if exists admin_slides_manage on public.homepage_slides;
drop policy if exists admin_enquiry_read on public.contact_enquiries;
drop policy if exists admin_enquiry_update on public.contact_enquiries;
drop policy if exists super_admin_projects_manage on public.projects;
drop policy if exists super_admin_news_manage on public.news;
drop policy if exists super_admin_events_manage on public.events;
drop policy if exists super_admin_albums_manage on public.photo_albums;
drop policy if exists super_admin_images_manage on public.gallery_images;
drop policy if exists super_admin_videos_manage on public.videos;
drop policy if exists super_admin_awards_manage on public.awards;
drop policy if exists super_admin_reports_manage on public.annual_audit_reports;
drop policy if exists super_admin_team_manage on public.management_team;
drop policy if exists super_admin_slides_manage on public.homepage_slides;
drop policy if exists super_admin_enquiry_manage on public.contact_enquiries;
create policy super_admin_projects_manage on public.projects for all to authenticated using(public.has_role(array['super_admin']::public.app_role[])) with check(public.has_role(array['super_admin']::public.app_role[]));
create policy super_admin_news_manage on public.news for all to authenticated using(public.has_role(array['super_admin']::public.app_role[])) with check(public.has_role(array['super_admin']::public.app_role[]));
create policy super_admin_events_manage on public.events for all to authenticated using(public.has_role(array['super_admin']::public.app_role[])) with check(public.has_role(array['super_admin']::public.app_role[]));
create policy super_admin_albums_manage on public.photo_albums for all to authenticated using(public.has_role(array['super_admin']::public.app_role[])) with check(public.has_role(array['super_admin']::public.app_role[]));
create policy super_admin_images_manage on public.gallery_images for all to authenticated using(public.has_role(array['super_admin']::public.app_role[])) with check(public.has_role(array['super_admin']::public.app_role[]));
create policy super_admin_videos_manage on public.videos for all to authenticated using(public.has_role(array['super_admin']::public.app_role[])) with check(public.has_role(array['super_admin']::public.app_role[]));
create policy super_admin_awards_manage on public.awards for all to authenticated using(public.has_role(array['super_admin']::public.app_role[])) with check(public.has_role(array['super_admin']::public.app_role[]));
create policy super_admin_reports_manage on public.annual_audit_reports for all to authenticated using(public.has_role(array['super_admin']::public.app_role[])) with check(public.has_role(array['super_admin']::public.app_role[]));
create policy super_admin_team_manage on public.management_team for all to authenticated using(public.has_role(array['super_admin']::public.app_role[])) with check(public.has_role(array['super_admin']::public.app_role[]));
create policy super_admin_slides_manage on public.homepage_slides for all to authenticated using(public.has_role(array['super_admin']::public.app_role[])) with check(public.has_role(array['super_admin']::public.app_role[]));
create policy super_admin_enquiry_manage on public.contact_enquiries for all to authenticated using(public.has_role(array['super_admin']::public.app_role[])) with check(public.has_role(array['super_admin']::public.app_role[]));

drop policy if exists admin_public_media_upload on storage.objects;
drop policy if exists admin_public_media_update on storage.objects;
drop policy if exists admin_public_media_delete on storage.objects;
drop policy if exists super_admin_public_media_upload on storage.objects;
drop policy if exists super_admin_public_media_update on storage.objects;
drop policy if exists super_admin_public_media_delete on storage.objects;
create policy super_admin_public_media_upload on storage.objects for insert to authenticated with check(bucket_id='public-media' and public.has_role(array['super_admin']::public.app_role[]));
create policy super_admin_public_media_update on storage.objects for update to authenticated using(bucket_id='public-media' and public.has_role(array['super_admin']::public.app_role[])) with check(bucket_id='public-media' and public.has_role(array['super_admin']::public.app_role[]));
create policy super_admin_public_media_delete on storage.objects for delete to authenticated using(bucket_id='public-media' and public.has_role(array['super_admin']::public.app_role[]));

-- Membership numbers are issued only after approval, never to pending accounts.
create or replace function public.assign_membership_number()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.status='approved' and (new.membership_no is null or trim(new.membership_no)='') then
    new.membership_no := 'ABVDS-'||to_char(current_date,'YYYY')||'-'||lpad(nextval('public.membership_number_seq')::text,6,'0');
  end if;
  return new;
end;
$$;
