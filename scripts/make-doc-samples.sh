#!/bin/sh
# Full pages of small printed text, the way a document scan really looks: one already
# clean and bright like Apple's scanner gives, one dim, soft and low-contrast.
# sh scripts/make-doc-samples.sh <folder>
OUT="${1:-scripts/scan-samples}"
mkdir -p "$OUT"
ARIAL="fontfile='C\:/Windows/Fonts/arial.ttf'"
TIMES="fontfile='C\:/Windows/Fonts/times.ttf'"
TEXT="The cell membrane controls what enters and leaves the cell and protects what is inside it"
TEXT2="Enzymes speed up reactions in the body and each one only works on a certain molecule"

# Letter page at 300 dots per inch: 42 is 10 point text, 33 is 8 point.
F=""
F="${F}drawtext=$ARIAL:text='Unit 4 Worksheet - Cells and Energy':x=225:y=200:fontsize=75:fontcolor=0x111111,"
y=360; n=1
while [ $y -lt 1900 ]; do
  F="${F}drawtext=$TIMES:text='$n. $TEXT':x=225:y=$y:fontsize=42:fontcolor=0x222222,"
  F="${F}drawtext=$TIMES:text='$TEXT2 and stops when it runs out':x=225:y=$((y+58)):fontsize=42:fontcolor=0x222222,"
  y=$((y+170)); n=$((n+1))
done
F="${F}drawbox=x=225:y=1960:w=2100:h=620:color=0x333333:t=4,"
y=2000
while [ $y -lt 2540 ]; do
  F="${F}drawtext=$ARIAL:text='$TEXT':x=260:y=$y:fontsize=33:fontcolor=0x555555,"
  F="${F}drawbox=x=225:y=$((y+50)):w=2100:h=2:color=0x888888:t=fill,"
  y=$((y+66))
done
F="${F}drawtext=$ARIAL:text='Page 3 of 12 - copyright notice in tiny grey print':x=225:y=2800:fontsize=25:fontcolor=0x888888"

# Clean and bright, a little soft.
ffmpeg -y -v error -f lavfi -i "color=c=0xFDFDFB:s=2550x3300" -vf "${F},gblur=sigma=1.1,noise=alls=3:allf=t" -frames:v 1 -q:v 3 "$OUT/doc-clean.jpg"
# Dim, soft, grey paper, lower resolution: a quick photo under a classroom light.
ffmpeg -y -v error -f lavfi -i "color=c=0xE4E1D8:s=2550x3300" -vf "${F},vignette=PI/5,geq=lum='lum(X,Y)*(0.8-0.12*Y/H)':cb='cb(X,Y)':cr='cr(X,Y)',gblur=sigma=2.4,noise=alls=9:allf=t,scale=1600:2070" -frames:v 1 -q:v 7 "$OUT/doc-dim.jpg"
ls -la "$OUT"
