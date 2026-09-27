#!/usr/bin/env bash
# Creates the GCP demo target on the free tier and a service account that can reset ONLY that VM.
# usage: PROJECT=my-project ./infra/gcp-setup.sh   (run from the repo root, gcloud logged in)
set -euo pipefail
: "${PROJECT:?set PROJECT to your GCP project id}"
ZONE=${ZONE:-us-central1-a}   # free-tier e2-micro regions: us-west1, us-central1, us-east1
VM=${VM:-opsswipe-demo}
SA=opsswipe-remediator
SA_EMAIL="$SA@$PROJECT.iam.gserviceaccount.com"

gcloud config set project "$PROJECT"
gcloud services enable compute.googleapis.com iam.googleapis.com aiplatform.googleapis.com

gcloud compute instances create "$VM" --zone "$ZONE" --machine-type e2-micro \
  --image-family debian-12 --image-project debian-cloud \
  --boot-disk-size 10GB --boot-disk-type pd-standard \
  --tags http-server --metadata-from-file startup-script=infra/demo-box.sh
gcloud compute firewall-rules create opsswipe-allow-http --allow tcp:80 --target-tags http-server || true

# Least privilege: a custom role with just reset + get, bound on this one instance (not the project).
gcloud iam service-accounts create "$SA" --display-name "OpsSwipe remediator" || true
gcloud iam roles create opsswipeReset --project "$PROJECT" --title "OpsSwipe reset" \
  --permissions compute.instances.reset,compute.instances.get || true
gcloud compute instances add-iam-policy-binding "$VM" --zone "$ZONE" \
  --member "serviceAccount:$SA_EMAIL" --role "projects/$PROJECT/roles/opsswipeReset"

# Optional AI suggestions: Claude on Vertex, billed to this project's credits.
# Also enable the Claude model once in Vertex AI -> Model Garden.
gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:$SA_EMAIL" \
  --role roles/aiplatform.user --condition=None >/dev/null

gcloud iam service-accounts keys create gcp-sa-key.json --iam-account "$SA_EMAIL"
IP=$(gcloud compute instances describe "$VM" --zone "$ZONE" --format 'get(networkInterfaces[0].accessConfigs[0].natIP)')
echo
echo "VM ready: http://$IP/  (give the startup script ~1 min)"
echo "Key written to gcp-sa-key.json (gitignored). Store it with:"
echo "  npx supabase secrets set GCP_SA_KEY=\"\$(cat gcp-sa-key.json)\""
echo "TARGETS entry: \"gcp-vm\":{\"provider\":\"gcp\",\"project\":\"$PROJECT\",\"zone\":\"$ZONE\",\"instance\":\"$VM\",\"url\":\"http://$IP/\"}"
