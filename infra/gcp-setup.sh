#!/usr/bin/env bash
# Two things, run from the repo root with gcloud logged in to your personal account:
#   1. OpsSwipe's platform identity (once per OpsSwipe deployment): a service account with no
#      access to anything by default. Users grant it a reset-only role on their own VMs.
#   2. A free-tier demo VM, granted to that identity exactly the way the app tells users to.
# usage: PROJECT=my-project ./infra/gcp-setup.sh
set -euo pipefail
: "${PROJECT:?set PROJECT to your GCP project id}"
ZONE=${ZONE:-us-central1-a}   # free-tier e2-micro regions: us-west1, us-central1, us-east1
VM=${VM:-opsswipe-demo}
SA=opsswipe
SA_EMAIL="$SA@$PROJECT.iam.gserviceaccount.com"

gcloud config set project "$PROJECT"
gcloud services enable compute.googleapis.com iam.googleapis.com aiplatform.googleapis.com \
  cloudresourcemanager.googleapis.com   # also serves "Connect Google Cloud" calls made with users' tokens

# 1. Platform identity. Its only project-level role is Vertex AI (Claude suggestions on your credits).
gcloud iam service-accounts create "$SA" --display-name "OpsSwipe platform" || true
gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:$SA_EMAIL" \
  --role roles/aiplatform.user --condition=None >/dev/null
gcloud iam service-accounts keys create gcp-sa-key.json --iam-account "$SA_EMAIL"

# 2. Demo VM (nginx), then the same two commands the app shows any user connecting a VM.
gcloud compute instances create "$VM" --zone "$ZONE" --machine-type e2-micro \
  --image-family debian-12 --image-project debian-cloud \
  --boot-disk-size 10GB --boot-disk-type pd-standard \
  --tags http-server --metadata-from-file startup-script=infra/demo-box.sh
gcloud compute firewall-rules create opsswipe-allow-http --allow tcp:80 --target-tags http-server || true
gcloud iam roles create opsswipeReset --project "$PROJECT" --title "OpsSwipe reset" \
  --permissions compute.instances.reset,compute.instances.get || true
gcloud compute instances add-iam-policy-binding "$VM" --zone "$ZONE" \
  --member "serviceAccount:$SA_EMAIL" --role "projects/$PROJECT/roles/opsswipeReset"

IP=$(gcloud compute instances describe "$VM" --zone "$ZONE" --format 'get(networkInterfaces[0].accessConfigs[0].natIP)')
echo
echo "Platform identity: $SA_EMAIL"
echo "  store its key:   npx supabase secrets set GCP_SA_KEY=\"\$(cat gcp-sa-key.json)\"   (key file is gitignored)"
echo "Demo VM: http://$IP/  (give the startup script ~1 min)"
echo "  in the app: Services -> Add a service -> GCP VM: project $PROJECT, zone $ZONE, VM $VM, URL http://$IP/"
