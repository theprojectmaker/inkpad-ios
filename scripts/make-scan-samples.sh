#!/bin/sh
# Makes hard test pictures for the scan cleanup: dim, grainy, soft phone photos of
# handwriting and of a worksheet with a picture on it. Uses ffmpeg and Windows fonts.
# sh scripts/make-scan-samples.sh <folder>
OUT="${1:-scripts/scan-samples}"
mkdir -p "$OUT"
HAND="fontfile='C\:/Windows/Fonts/Inkfree.ttf'"
ARIAL="fontfile='C\:/Windows/Fonts/arial.ttf'"

line() { # text x y size colour font
  printf "drawtext=%s:text='%s':x=%s:y=%s:fontsize=%s:fontcolor=%s," "$6" "$1" "$2" "$3" "$4" "$5"
}

# Lined paper notes: pencil, blue pen, red pen, a highlighter, an uneven shadow.
F=""
y=120; while [ $y -lt 1900 ]; do F="${F}drawbox=x=0:y=$y:w=1500:h=2:color=0x9DB4D6@0.7:t=fill,"; y=$((y+74)); done
F="${F}drawbox=x=150:y=0:w=2:h=2000:color=0xE08A8A@0.7:t=fill,"
F="${F}drawbox=x=180:y=320:w=720:h=62:color=0xFFE14D@0.75:t=fill,"
F="${F}$(line 'Biology notes - Cell structure' 190 60 70 0x22242A "$HAND")"
F="${F}$(line 'The mitochondria makes energy (ATP)' 190 195 54 0x1E3FBF "$HAND")"
F="${F}$(line 'Ribosomes build proteins from RNA' 190 269 54 0x1E3FBF "$HAND")"
F="${F}$(line 'Know this for the test on Friday!' 190 330 54 0x2A2A2E "$HAND")"
F="${F}$(line 'light pencil - nucleus holds the DNA' 190 417 54 0x8C8C90 "$HAND")"
F="${F}$(line 'cell wall only in plants' 190 491 54 0x8C8C90 "$HAND")"
F="${F}$(line '2H2 + O2 = 2H2O   x = (3 + 5) / 2' 190 565 56 0xC8241F "$HAND")"
F="${F}$(line 'Vacuole stores water and waste' 190 639 54 0x22242A "$HAND")"
F="${F}$(line 'small tiny writing in the margin here' 190 725 34 0x33353B "$HAND")"
F="${F}$(line 'Chloroplast = photosynthesis' 190 787 54 0x0A7A42 "$HAND")"
ffmpeg -y -v error -f lavfi -i "color=c=0xF4EFE3:s=1500x2000" \
  -vf "${F}vignette=PI/3.2,geq=lum='lum(X,Y)*(0.62+0.38*X/W)':cb='cb(X,Y)':cr='cr(X,Y)',gblur=sigma=1.5,noise=alls=14:allf=t,scale=1125:1500" \
  -frames:v 1 -q:v 9 "$OUT/notes.jpg"

# A printed worksheet with a picture and pencil answers, in a darker room.
F=""
F="${F}$(line 'Chapter 7 Review' 110 90 62 0x1A1A1A "$ARIAL")"
F="${F}$(line '1. Name the part labelled in the picture below.' 110 200 34 0x1A1A1A "$ARIAL")"
F="${F}$(line 'The answer is the stem cell' 150 262 50 0x55565C "$HAND")"
F="${F}drawbox=x=110:y=320:w=1100:h=2:color=0x222222:t=fill,"
F="${F}$(line '2. Solve for x  3x + 7 = 22' 110 360 34 0x1A1A1A "$ARIAL")"
F="${F}$(line 'x = 5' 150 420 56 0x1E3FBF "$HAND")"
F="${F}$(line 'small print - see page 214 of your textbook for the full table.' 110 1680 22 0x333333 "$ARIAL")"
ffmpeg -y -v error -f lavfi -i "color=c=0xE9E6DD:s=1500x2000" -f lavfi -i "testsrc2=s=620x480:d=1" -filter_complex \
  "[1:v]eq=saturation=0.8[pic];[0:v][pic]overlay=280:560,${F}vignette=PI/3,geq=lum='lum(X,Y)*(0.74-0.18*Y/H)':cb='cb(X,Y)':cr='cr(X,Y)',gblur=sigma=1.8,noise=alls=12:allf=t,scale=1200:1600" \
  -frames:v 1 -q:v 8 "$OUT/worksheet.jpg"
ls -la "$OUT"
